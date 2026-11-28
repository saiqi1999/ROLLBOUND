import type {PlaytestRun} from '../playtest-run.ts';
import {isCompletedPlaytestRun,pendingReviewKey,readLegacyArchive,runKey,type Archive,type PlaytestKV} from './playtest-archive.ts';
import {refreshMirrorPool,type MirrorManifest} from './match-mirrors.ts';

type ArchiveState={storage:{get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>}};
type Migration={revision:number;offset:number};

export class PlaytestArchive{
  private state:ArchiveState;
  private kv:PlaytestKV;
  private pending=Promise.resolve();
  private legacy?:Archive;

  constructor(state:ArchiveState,env:{PLAYTEST_RUNS:PlaytestKV}){
    this.state=state;
    this.kv=env.PLAYTEST_RUNS;
  }

  async fetch(request:Request){
    const work=this.pending.then(()=>this.handle(request));
    this.pending=work.then(()=>{},()=>{});
    try{return await work;}
    catch(error){
      console.warn('Playtest storage operation failed.',error);
      return new Response(null,{status:503,headers:{'retry-after':'2'}});
    }
  }

  private async handle(request:Request){
    switch(new URL(request.url).pathname){
      case '/append':{
        const run:unknown=await request.json();
        if(!isCompletedPlaytestRun(run))return new Response(null,{status:400});
        return new Response(null,{status:await this.append(run)});
      }
      case '/migrate':return new Response(null,{status:await this.migrate()});
      case '/refresh':{
        const requestedAt=Number(await request.text());
        if(!Number.isSafeInteger(requestedAt)||requestedAt<1)return new Response(null,{status:400});
        const previous=await this.state.storage.get<MirrorManifest>('mirror-manifest');
        if(previous&&previous.requestedAt>=requestedAt)return Response.json(previous);
        const manifest=await refreshMirrorPool(this.kv,requestedAt);
        await this.state.storage.put('mirror-manifest',manifest);
        return Response.json(manifest);
      }
      default:return new Response(null,{status:404});
    }
  }

  private async append(run:PlaytestRun){
    const key=runKey(run.runId);
    const body=JSON.stringify(run);
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)));
    const digest=Array.from(hash,byte=>byte.toString(16).padStart(2,'0')).join('');
    const digestKey='digest:'+run.runId;
    const accepted=await this.state.storage.get<string>(digestKey);
    if(accepted!==undefined)return accepted===digest?204:409;

    this.legacy??=await readLegacyArchive(this.kv);
    const previous=this.legacy?.runs[run.runId];
    const stored=await this.kv.get(key);
    if((previous&&JSON.stringify(previous)!==body)||(stored!==null&&stored!==body))return 409;
    if(stored===null){
      if(!previous){
        const pending=pendingReviewKey(run);
        if(await this.kv.get(pending)===null)await this.kv.put(pending,JSON.stringify({runId:run.runId}));
      }
      await this.kv.put(key,body);
    }
    await this.state.storage.put(digestKey,digest);
    return previous||stored!==null?204:201;
  }

  private async migrate(){
    const archive=await readLegacyArchive(this.kv);
    if(!archive)return 204;
    const saved=await this.state.storage.get<Migration>('legacy-migration');
    const offset=saved?.revision===archive.revision?saved.offset:0;
    const ids=Object.keys(archive.runs).sort();
    const batch=ids.slice(offset,offset+16);
    if(!batch.length)return 204;
    const values=await this.kv.get(batch.map(runKey));
    const writes=await Promise.allSettled(batch.map(async id=>{
      const run=archive.runs[id];
      if(!isCompletedPlaytestRun(run)||run.runId!==id)throw Error('Invalid legacy run.');
      const key=runKey(id);
      const stored=values.get(key)??null;
      const body=JSON.stringify(run);
      if(stored===null)await this.kv.put(key,body);
      else if(stored!==body)throw Error('Legacy run conflicts with an individual record.');
    }));
    if(writes.some(write=>write.status==='rejected'))throw Error('Legacy archive backfill incomplete.');
    await this.state.storage.put('legacy-migration',{revision:archive.revision,offset:offset+batch.length});
    return offset+batch.length===ids.length?204:202;
  }
}
