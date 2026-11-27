import {encounters} from './data.ts';
import type {Run} from './engine.ts';
import {captureLineup,type LineupRecord} from './lineup-log.ts';

type CompletedLineup=LineupRecord & {result:NonNullable<LineupRecord['result']>;ticks:number};

export type PlaytestRun = {
  schemaVersion:1;
  runId:string;
  seed:number;
  finishedAt:number;
  battles:CompletedLineup[];
};

export type PlaytestProgress =
  | {battles:CompletedLineup[];finishedAt?:number}
  | {uploaded:true};

export function recordPlaytestBattle(run:Run,now=Date.now()){
  if(run.phase==='shop'||run.phase==='battle')return;
  const existing=run.playtest;
  if(existing&&'uploaded' in existing)return;
  const record=captureLineup(run);
  if(!record||record.result===null||record.ticks===null)return;

  const progress:Extract<PlaytestProgress,{battles:CompletedLineup[]}>=existing??{battles:[]};
  run.playtest=progress;
  if(progress.battles.at(-1)?.round!==record.round){
    progress.battles.push({...record,result:record.result,ticks:record.ticks});
  }
  if(run.phase==='end'||run.stage===encounters.length-1){
    progress.finishedAt??=Math.max(now,record.startedAt);
  }
}

export function finishedPlaytestRun(run:Run):PlaytestRun|undefined{
  const progress=run.playtest;
  if(!run.lineupRunId||!progress||'uploaded' in progress||!progress.finishedAt||!progress.battles.length)return;
  return {schemaVersion:1,runId:run.lineupRunId,seed:run.seed,finishedAt:progress.finishedAt,battles:progress.battles};
}
