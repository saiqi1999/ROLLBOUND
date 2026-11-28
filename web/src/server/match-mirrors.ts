import {isMirrorLineup,isMirrorRound,mirrorRounds,type MirrorBundle} from '../mirror-lineups.ts';
import {isCompletedPlaytestRun,readArchive,runIdPattern,type PlaytestKV} from './playtest-archive.ts';

export const approvedMirrorsKey='mirror:approved';
type Approval={runId:string;ruleset:number;rounds:number[]};
type ApprovedMirrors={schemaVersion:1;opponents:Approval[]};

export async function matchMirrors(kv:PlaytestKV,ruleset:number):Promise<MirrorBundle>{
  const rounds:MirrorBundle['rounds']={};
  const serialized=await kv.get(approvedMirrorsKey);
  if(serialized===null)return {ruleset,rounds};
  const pool=JSON.parse(serialized) as ApprovedMirrors|null;
  if(pool?.schemaVersion!==1||!Array.isArray(pool.opponents))throw Error('Invalid approved mirror pack.');
  const approvals=pool.opponents.filter(item=>item?.ruleset===ruleset&&typeof item.runId==='string'&&runIdPattern.test(item.runId)&&
    Array.isArray(item.rounds)&&item.rounds.some(isMirrorRound));
  if(!approvals.length)return {ruleset,rounds};

  const {runs}=await readArchive(kv);
  const choices:MirrorBundle['rounds'][]=[];
  for(const approval of approvals){
    const run=runs[approval.runId];
    if(!isCompletedPlaytestRun(run))continue;
    const choice:MirrorBundle['rounds']={};
    for(const {round,ruleset:recordRuleset,lineup} of run.battles){
      if(recordRuleset!==ruleset||!isMirrorRound(round)||!approval.rounds.includes(round))continue;
      const mirror={starters:lineup.starters.filter(unit=>!unit.cloneOf),reserves:lineup.reserves};
      if(isMirrorLineup(mirror))choice[round]=mirror;
    }
    choices.push(choice);
  }
  const pick=<T>(options:T[])=>options[Math.floor(Math.random()*options.length)] as T|undefined;
  const paired=pick(choices.filter(choice=>mirrorRounds.every(round=>choice[round])));
  if(paired)return {ruleset,rounds:paired};
  for(const round of mirrorRounds){
    const choice=pick(choices.filter(choice=>choice[round]));
    if(choice)rounds[round]=choice[round];
  }
  return {ruleset,rounds};
}
