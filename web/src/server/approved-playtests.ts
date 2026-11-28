import {approvedLineups,type Approval,type ApprovedMirrors,type ApprovedRound} from './match-mirrors.ts';
import {digestOf,listRunPages,readRunValue,runKeyPrefix,type PlaytestKV} from './playtest-archive.ts';

type BatchItem={finishedAt:number;keyDigest:string;ruleset:number;rounds:ApprovedRound[]};
export type ApprovalBatch={entries:BatchItem[]};

async function resolveApproval(kv:PlaytestKV,{finishedAt,keyDigest,ruleset,rounds}:BatchItem){
  for await(const keys of listRunPages(kv,runKeyPrefix(finishedAt))){
    for(const key of keys){
      if(await digestOf(key)!==keyDigest)continue;
      const run=readRunValue(key,JSON.parse(await kv.get(key)??'null'));
      if(!run)break;
      const approval:Approval={runId:run.runId,ruleset,rounds};
      const lineups=approvedLineups(run,approval);
      if(!rounds.length||!rounds.every(round=>lineups[round]))throw Error('An approved lineup is missing.');
      return approval;
    }
  }
  throw Error('An approved playtest is missing.');
}

export async function resolveApprovalBatch(kv:PlaytestKV,batch:ApprovalBatch){
  return Promise.all(batch.entries.map(entry=>resolveApproval(kv,entry)));
}

export function mergeApprovedPlaytests(pool:ApprovedMirrors,approvals:Approval[]){
  let changed=false;
  for(const {runId,ruleset,rounds} of approvals){
    const existing=pool.opponents.filter(item=>item?.runId===runId&&item.ruleset===ruleset&&Array.isArray(item.rounds));
    const missing=rounds.filter(round=>!existing.some(item=>item.rounds.includes(round)));
    if(!missing.length)continue;
    if(existing.length)existing[0].rounds.push(...missing);
    else pool.opponents.push({runId,ruleset,rounds:missing});
    changed=true;
  }
  return changed;
}
