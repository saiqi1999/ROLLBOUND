import {isMirrorLineup,isMirrorRound,mirrorRounds,type MirrorBundle} from '../mirror-lineups.ts';
import type {Lineup} from '../lineup-log.ts';
import type {PlaytestRun} from '../playtest-run.ts';
import {
  isCompletedPlaytestRun,legacyRunKey,listRunPages,playtestRunPrefix,readLegacyArchive,
  readRunValue,runIdForKey,runIdPattern,type PlaytestKV,
} from './playtest-archive.ts';

export const approvedMirrorsKey='mirror:approved';
const approvedPrefix='approvedkey_version1:';
export const mirrorRefreshKey=approvedPrefix+'refresh';
export const mirrorManifestKey=approvedPrefix+'manifest';
export type Approval={runId:string;ruleset:number;rounds:number[]};
export type ApprovedMirrors={schemaVersion:1;opponents:Approval[]};
const approvedRounds=[4,5,6,7] as const;
export type ApprovedRound=(typeof approvedRounds)[number];
type RoundCounts=Partial<Record<ApprovedRound,number>>;
export type MirrorManifest={schemaVersion:1;generation:string;requestedAt:number;counts:Record<number,RoundCounts>};
type Slot={key:string;value:string};

function mirrorSlotKey(ruleset:number,round:number,generation:string,index:number){
  return approvedPrefix+[ruleset,round,generation,index].join(':');
}

function isApprovedRound(round:number):round is ApprovedRound{
  return approvedRounds.some(candidate=>candidate===round);
}

export async function readApprovedMirrors(kv:PlaytestKV):Promise<ApprovedMirrors>{
  const serialized=await kv.get(approvedMirrorsKey);
  if(serialized===null)return {schemaVersion:1,opponents:[]};
  const pool=JSON.parse(serialized) as ApprovedMirrors|null;
  if(pool?.schemaVersion!==1||!Array.isArray(pool.opponents))throw Error('Invalid approved mirror pack.');
  return pool;
}

function validApprovals(pool:ApprovedMirrors){
  return pool.opponents.filter(item=>Number.isSafeInteger(item?.ruleset)&&item.ruleset>0&&
    typeof item.runId==='string'&&runIdPattern.test(item.runId)&&
    Array.isArray(item.rounds)&&item.rounds.some(isApprovedRound));
}

async function readApprovedRuns(kv:PlaytestKV,approvals:Approval[]){
  const missing=new Set(approvals.map(item=>item.runId));
  const runs=new Map<string,PlaytestRun>();
  if(!missing.size)return runs;
  for await(const page of listRunPages(kv,playtestRunPrefix,1000)){
    const keys=page.filter(key=>missing.has(runIdForKey(key)??''));
    for(let i=0;i<keys.length;i+=25){
      const batch=keys.slice(i,i+25);
      const values=await kv.get(batch);
      for(const key of batch){
        const run=readRunValue(key,JSON.parse(values.get(key)??'null'));
        if(run){
          runs.set(run.runId,run);
          missing.delete(run.runId);
        }
      }
    }
    if(!missing.size)return runs;
  }

  const ids=[...missing];
  for(let i=0;i<ids.length;i+=25){
    const batch=ids.slice(i,i+25);
    const values=await kv.get(batch.map(legacyRunKey));
    for(const id of batch){
      const key=legacyRunKey(id);
      const run=readRunValue(key,JSON.parse(values.get(key)??'null'));
      if(run){
        runs.set(id,run);
        missing.delete(id);
      }
    }
  }
  if(missing.size){
    const archive=await readLegacyArchive(kv);
    for(const id of missing){
      const run=archive?.runs[id];
      if(isCompletedPlaytestRun(run)&&run.runId===id)runs.set(id,run);
    }
  }
  return runs;
}

export function approvedLineups(run:PlaytestRun,approval:Approval){
  const rounds:Partial<Record<ApprovedRound,Lineup>>={};
  for(const {round,ruleset,lineup} of run.battles){
    if(ruleset!==approval.ruleset||!isApprovedRound(round)||!approval.rounds.includes(round))continue;
    const mirror={starters:lineup.starters.filter(unit=>!unit.cloneOf),reserves:lineup.reserves};
    if(isMirrorLineup(mirror))rounds[round]=mirror;
  }
  return rounds;
}

export async function refreshMirrorPool(kv:PlaytestKV,requestedAt:number,pool?:ApprovedMirrors){
  const approvals=validApprovals(pool??await readApprovedMirrors(kv));
  const runs=await readApprovedRuns(kv,approvals);
  const manifest:MirrorManifest={schemaVersion:1,generation:requestedAt+'-'+crypto.randomUUID(),requestedAt,counts:{}};
  const slots:Slot[]=[];
  const included=new Set<string>();
  approvals.sort((a,b)=>(runs.get(a.runId)?.finishedAt??0)-(runs.get(b.runId)?.finishedAt??0)||
    a.runId.localeCompare(b.runId));
  for(const approval of approvals){
    const run=runs.get(approval.runId);
    if(!run)throw Error('An approved run is unavailable.');
    const lineups=approvedLineups(run,approval);
    for(const round of approvedRounds){
      const lineup=lineups[round];
      const identity=[approval.ruleset,round,run.runId].join(':');
      if(!lineup||included.has(identity))continue;
      included.add(identity);
      const counts=manifest.counts[approval.ruleset]??={};
      const id=(counts[round]??0)+1;
      counts[round]=id;
      slots.push({
        key:mirrorSlotKey(approval.ruleset,round,manifest.generation,id),
        value:JSON.stringify({runId:run.runId,lineup}),
      });
    }
  }

  for(let i=0;i<slots.length;i+=12){
    await Promise.all(slots.slice(i,i+12).map(slot=>kv.put(slot.key,slot.value)));
  }
  // Stale readers can finish using their old generation while this one propagates.
  await kv.put(mirrorManifestKey,JSON.stringify(manifest));
  return manifest;
}

async function matchDensePool(kv:PlaytestKV,ruleset:number,manifest:MirrorManifest):Promise<MirrorBundle>{
  const rounds:MirrorBundle['rounds']={};
  const choices=mirrorRounds.flatMap(round=>{
    const count=manifest.counts[ruleset]?.[round]??0;
    if(!Number.isSafeInteger(count)||count<1)return [];
    const id=1+Math.floor(Math.random()*count);
    return [{round,key:mirrorSlotKey(ruleset,round,manifest.generation,id)}];
  });
  if(!choices.length)return {ruleset,rounds};
  const values=await kv.get(choices.map(choice=>choice.key));
  for(const choice of choices){
    const slot=JSON.parse(values.get(choice.key)??'null');
    if(isMirrorLineup(slot?.lineup))rounds[choice.round]=slot.lineup;
  }
  return {ruleset,rounds};
}

export async function readMirrorManifest(kv:PlaytestKV){
  return JSON.parse(await kv.get(mirrorManifestKey)??'null') as MirrorManifest|null;
}

export async function matchMirrors(kv:PlaytestKV,ruleset:number,manifest?:MirrorManifest|null):Promise<MirrorBundle>{
  if(manifest===undefined)manifest=await readMirrorManifest(kv);
  if(manifest?.schemaVersion===1)return matchDensePool(kv,ruleset,manifest);

  const rounds:MirrorBundle['rounds']={};
  const approvals=validApprovals(await readApprovedMirrors(kv))
    .filter(item=>item.ruleset===ruleset&&item.rounds.some(isMirrorRound));
  if(!approvals.length)return {ruleset,rounds};

  const runs=await readApprovedRuns(kv,approvals);
  const choices:MirrorBundle['rounds'][]=[];
  for(const approval of approvals){
    const run=runs.get(approval.runId);
    if(run)choices.push(approvedLineups(run,{...approval,rounds:approval.rounds.filter(isMirrorRound)}));
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
