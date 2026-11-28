import {encounters} from '../data.ts';
import type {PlaytestRun} from '../playtest-run.ts';
import {isLineupRecord} from './lineups.ts';

export const playtestArchiveKey='playtest:all';
export const runIdPattern=/^[0-9a-f]{32}$/;
export type PlaytestKV={
  get(key:string):Promise<string|null>;
  get(keys:string[]):Promise<Map<string,string|null>>;
  list(options:{prefix:string;limit:number;cursor?:string}):Promise<{
    keys:{name:string}[];list_complete:boolean;cursor?:string;
  }>;
  put(key:string,value:string):Promise<void>;
};

type Archive={schemaVersion:1;revision:number;runs:Record<string,PlaytestRun>};
type WriteState={revision:number;writtenAt:number};
type ArchiveState={storage:{get<T>(key:string):Promise<T|undefined>;put(key:string,value:WriteState):Promise<void>}};

const runFields=new Set(['schemaVersion','runId','seed','finishedAt','battles']);
const battleFields=new Set(['battleId','runId','round','seed','ruleset','startedAt','fireballs','lineup','result','ticks']);
const maxArchiveBytes=25*1024*1024;

export function isCompletedPlaytestRun(value:unknown):value is PlaytestRun{
  if(!value||typeof value!=='object'||!Object.keys(value).every(key=>runFields.has(key)))return false;
  const run=value as Partial<PlaytestRun>;
  if(run.schemaVersion!==1||typeof run.runId!=='string'||!runIdPattern.test(run.runId)||
    typeof run.finishedAt!=='number'||!Number.isSafeInteger(run.finishedAt)||run.finishedAt<1||
    !Array.isArray(run.battles)||!run.battles.length||run.battles.length>encounters.length)return false;

  const seen=new Set<string>();
  let previousRound:number|undefined;
  for(const [index,battle] of run.battles.entries()){
    const finalBattle=index===run.battles.length-1;
    if(!isLineupRecord(battle)||battle.runId!==run.runId||battle.seed!==run.seed||
      battle.result===null||!Object.keys(battle).every(key=>battleFields.has(key))||
      !Object.keys(battle.lineup).every(key=>key==='starters'||key==='reserves')||
      seen.has(battle.battleId)||(previousRound!==undefined&&battle.round!==previousRound+1)||
      (!finalBattle&&battle.result!=='win')||
      (finalBattle&&(run.finishedAt<battle.startedAt||battle.result==='win'&&battle.round!==encounters.length))){
      return false;
    }
    seen.add(battle.battleId);
    previousRound=battle.round;
  }
  return true;
}

export function parseArchive(serialized:string):Archive{
  const archive=JSON.parse(serialized) as Archive|null;
  if(archive?.schemaVersion!==1||!Number.isSafeInteger(archive.revision)||archive.revision<1||
    !archive.runs||typeof archive.runs!=='object'||Array.isArray(archive.runs))throw Error('Invalid playtest archive.');
  return archive;
}

async function readLegacyRuns(kv:PlaytestKV){
  const runs:Archive['runs']={};
  let cursor:string|undefined;
  do{
    const page=await kv.list({prefix:'run:',limit:25,...(cursor?{cursor}:{})});
    const keys=page.keys.map(key=>key.name);
    if(keys.length){
      const values=await kv.get(keys);
      for(const key of keys){
        const value=JSON.parse(values.get(key)??'null');
        if(!isCompletedPlaytestRun(value)||key!=='run:'+value.runId)throw Error('Legacy playtest run unavailable.');
        runs[value.runId]=value;
      }
    }
    if(page.list_complete)break;
    if(!page.cursor||page.cursor===cursor)throw Error('Invalid playtest archive cursor.');
    cursor=page.cursor;
  }while(cursor);
  return runs;
}

export async function readArchive(kv:PlaytestKV):Promise<Archive>{
  const stored=await kv.get(playtestArchiveKey);
  return stored===null?{schemaVersion:1,revision:0,runs:await readLegacyRuns(kv)}:parseArchive(stored);
}

export class PlaytestArchive{
  private state:ArchiveState;
  private kv:PlaytestKV;
  private pending=Promise.resolve();
  private archive?:Archive;
  private writeState?:WriteState;

  constructor(state:ArchiveState,env:{PLAYTEST_RUNS:PlaytestKV}){
    this.state=state;
    this.kv=env.PLAYTEST_RUNS;
  }

  async fetch(request:Request){
    const run=await request.json() as PlaytestRun;
    const write=this.pending.then(()=>this.append(run));
    this.pending=write.then(()=>{},()=>{});
    try{return new Response(null,{status:await write});}
    catch{return new Response(null,{status:503,headers:{'retry-after':'2'}});}
  }

  private async append(run:PlaytestRun){
    const state=this.writeState??await this.state.storage.get<WriteState>('last-write');
    const archive=this.archive??await readArchive(this.kv);
    // A cold object can observe an older KV value. Never append to that copy.
    if(state&&archive.revision<state.revision)throw Error('Playtest archive is still propagating.');
    const previous=archive.runs[run.runId];
    if(previous&&JSON.stringify(previous)!==JSON.stringify(run))return 409;
    if(previous&&archive.revision){
      if(!state||archive.revision>state.revision)await this.confirmWrite(archive);
      return 204;
    }

    const next:Archive={schemaVersion:1,revision:archive.revision+1,runs:{...archive.runs,[run.runId]:run}};
    const body=JSON.stringify(next);
    if(new TextEncoder().encode(body).byteLength>maxArchiveBytes)return 507;
    const delay=state?state.writtenAt+1050-Date.now():0;
    if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    await this.kv.put(playtestArchiveKey,body);
    this.archive=next;
    await this.confirmWrite(next);
    return previous?204:201;
  }

  private async confirmWrite(archive:Archive){
    const state={revision:archive.revision,writtenAt:Date.now()};
    await this.state.storage.put('last-write',state);
    this.writeState=state;
  }
}
