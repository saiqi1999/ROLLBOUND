import type {PlaytestRun} from '../playtest-run.ts';
import {
  isCompletedPlaytestRun,legacyRunKey,legacyRunPrefix,listRunPages,playtestArchiveKey,readLegacyArchive,
  readRunValue,runKey,type PlaytestKV,
} from './playtest-archive.ts';
import {refreshMirrorPool,type MirrorManifest} from './match-mirrors.ts';

type ArchiveState={storage:{get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>}};
type LegacyArchiveProgress={revision:number;offset:number};
type Receipt=string|{digest:string};
const migrationCompleteKey='timestamped-migration-complete';
const batchSize=16;

async function digestOf(body:string){
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)));
  return Array.from(hash,byte=>byte.toString(16).padStart(2,'0')).join('');
}

export class PlaytestArchive{
  private state:ArchiveState;
  private kv:PlaytestKV;
  private pending=Promise.resolve();

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
    const key=runKey(run);
    const body=JSON.stringify(run);
    const digest=await digestOf(body);
    const digestKey='digest:'+run.runId;
    const accepted=await this.state.storage.get<Receipt>(digestKey);
    if(typeof accepted==='string')return accepted===digest?204:409;
    if(accepted&&accepted.digest!==digest)return 409;

    const stored=await this.kv.get(key);
    if(stored===body){
      await this.state.storage.put(digestKey,digest);
      return 204;
    }
    if(stored!==null&&readRunValue(key,JSON.parse(stored)))return 409;
    if(!accepted&&!await this.state.storage.get<boolean>(migrationCompleteKey)){
      const oldKey=legacyRunKey(run.runId);
      const [oldValue,archive]=await Promise.all([this.kv.get(oldKey),readLegacyArchive(this.kv)]);
      const previous=[readRunValue(oldKey,JSON.parse(oldValue??'null')),archive?.runs[run.runId]].filter(Boolean);
      if(previous.length){
        if(previous.some(value=>JSON.stringify(value)!==body))return 409;
        await this.state.storage.put(digestKey,digest);
        return 204;
      }
    }
    // Reserve the ID before writing KV so a failed or retried upload cannot change its timestamp.
    if(!accepted)await this.state.storage.put(digestKey,{digest});
    await this.kv.put(key,body);
    await this.state.storage.put(digestKey,digest);
    return 201;
  }

  private async migrate(){
    if(await this.state.storage.get<boolean>(migrationCompleteKey))return 204;
    const archive=await readLegacyArchive(this.kv);
    for await(const keys of listRunPages(this.kv,legacyRunPrefix,batchSize)){
      const values=await this.kv.get(keys);
      const runs:PlaytestRun[]=[];
      for(const key of keys){
        const run=readRunValue(key,JSON.parse(values.get(key)??'null'));
        if(!run)continue;
        const other=archive?.runs[run.runId];
        if(other&&JSON.stringify(other)!==JSON.stringify(run))throw Error('Conflicting legacy playtest copies.');
        runs.push(run);
      }
      if(runs.length&&await this.copyAndVerify(runs)){
        const deletions=await Promise.allSettled(runs.map(run=>this.kv.delete(legacyRunKey(run.runId))));
        if(deletions.some(result=>result.status==='rejected'))throw Error('Legacy playtest cleanup incomplete.');
      }
      return 202;
    }
    if(archive){
      await this.migrateLegacyArchive(archive.revision,archive.runs);
      return 202;
    }
    await this.state.storage.put(migrationCompleteKey,true);
    return 204;
  }

  private async migrateLegacyArchive(revision:number,runs:Record<string,PlaytestRun>){
    const saved=await this.state.storage.get<LegacyArchiveProgress>('timestamped-legacy-archive');
    const ids=Object.keys(runs).sort();
    const offset=saved?.revision===revision?saved.offset:0;
    const batch=ids.slice(offset,offset+batchSize).map(id=>{
      const run=runs[id];
      if(!isCompletedPlaytestRun(run)||run.runId!==id)throw Error('Invalid legacy archive record.');
      return run;
    });
    if(batch.length&&!await this.copyAndVerify(batch))return;
    const next=offset+batch.length;
    if(next<ids.length){
      await this.state.storage.put('timestamped-legacy-archive',{revision,offset:next});
      return;
    }
    await this.kv.delete(playtestArchiveKey);
  }

  private async copyAndVerify(runs:PlaytestRun[]){
    const entries=runs.map(run=>({run,key:runKey(run),body:JSON.stringify(run)}));
    const values=await this.kv.get(entries.map(entry=>entry.key));
    const missing=entries.filter(({key,body})=>{
      const stored=values.get(key)??null;
      if(stored===body)return false;
      if(stored!==null&&readRunValue(key,JSON.parse(stored)))throw Error('Conflicting timestamped playtest copy.');
      return true;
    });
    if(missing.length){
      const writes=await Promise.allSettled(missing.map(({key,body})=>this.kv.put(key,body)));
      if(writes.some(result=>result.status==='rejected'))throw Error('Playtest migration copy incomplete.');
      return false;
    }

    // Verify both read-back and discovery before removing a source used by exports.
    const listed=await Promise.all(entries.map(({key})=>this.kv.list({prefix:key,limit:1})));
    if(listed.some((page,index)=>!page.keys.some(entry=>entry.name===entries[index].key)))return false;
    for(const {run,body} of entries){
      const key='digest:'+run.runId;
      const digest=await digestOf(body);
      const previous=await this.state.storage.get<Receipt>(key);
      if(previous&&(typeof previous==='string'?previous:previous.digest)!==digest)throw Error('Conflicting playtest receipt.');
      if(previous!==digest)await this.state.storage.put(key,digest);
    }
    return true;
  }
}
