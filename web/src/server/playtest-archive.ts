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
  delete(key:string):Promise<void>;
};

export type Archive={schemaVersion:1;revision:number;runs:Record<string,PlaytestRun>};

const runFields=new Set(['schemaVersion','runId','seed','finishedAt','battles']);
const battleFields=new Set(['battleId','runId','round','seed','ruleset','startedAt','fireballs','lineup','result','ticks']);

export function runKey(runId:string){
  return 'run:'+runId;
}

export function pendingReviewKey(run:PlaytestRun){
  return 'newkey_version1:'+String(run.finishedAt).padStart(16,'0')+':'+run.runId;
}

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

async function readIndividualRuns(kv:PlaytestKV){
  const runs:Archive['runs']={};
  let cursor:string|undefined;
  do{
    const page=await kv.list({prefix:'run:',limit:25,...(cursor?{cursor}:{})});
    const keys=page.keys.map(key=>key.name);
    if(keys.length){
      const values=await kv.get(keys);
      for(const key of keys){
        const value=JSON.parse(values.get(key)??'null');
        if(!isCompletedPlaytestRun(value)||key!==runKey(value.runId))throw Error('Playtest run unavailable.');
        runs[value.runId]=value;
      }
    }
    if(page.list_complete)break;
    if(!page.cursor||page.cursor===cursor)throw Error('Invalid playtest archive cursor.');
    cursor=page.cursor;
  }while(cursor);
  return runs;
}

export async function readLegacyArchive(kv:PlaytestKV){
  const stored=await kv.get(playtestArchiveKey);
  return stored===null?undefined:parseArchive(stored);
}

export async function readArchive(kv:PlaytestKV):Promise<Archive>{
  const [legacy,runs]=await Promise.all([readLegacyArchive(kv),readIndividualRuns(kv)]);
  return {schemaVersion:1,revision:legacy?.revision??0,runs:{...legacy?.runs,...runs}};
}
