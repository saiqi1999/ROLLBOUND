import {encounters} from '../data.ts';
import type {PlaytestRun} from '../playtest-run.ts';
import {isLineupRecord,readBody} from './lineups.ts';

type Env = {
  PLAYTEST_ORIGIN:string;
  PLAYTEST_RUNS:{get(key:string):Promise<string|null>;put(key:string,value:string):Promise<void>};
  PLAYTEST_LIMITER:{limit(options:{key:string}):Promise<{success:boolean}>};
};

const maxBytes=512*1024;
const runIdPattern=/^[0-9a-f]{32}$/;
const runFields=new Set(['schemaVersion','runId','seed','finishedAt','battles']);
const battleFields=new Set(['battleId','runId','round','seed','ruleset','startedAt','fireballs','lineup','result','ticks']);

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

export async function receivePlaytestRun(request:Request,env:Env):Promise<Response>{
  if(new URL(request.url).pathname!=='/api/lineup-runs')return new Response(null,{status:404});
  const origin=request.headers.get('origin');
  if(!origin||origin!==env.PLAYTEST_ORIGIN)return new Response(null,{status:403});

  const headers={
    'access-control-allow-origin':origin,
    'cache-control':'no-store',
    vary:'Origin',
  };
  if(request.method==='OPTIONS'){
    return new Response(null,{status:204,headers:{
      ...headers,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type',
      'access-control-max-age':'600',
    }});
  }
  if(request.method!=='POST')return new Response(null,{status:405,headers:{...headers,allow:'POST, OPTIONS'}});
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){
    return new Response(null,{status:415,headers});
  }
  if(Number(request.headers.get('content-length'))>maxBytes)return new Response(null,{status:413,headers});
  if(!env.PLAYTEST_RUNS||!env.PLAYTEST_LIMITER)return new Response(null,{status:503,headers});

  try{
    const {success}=await env.PLAYTEST_LIMITER.limit({key:request.headers.get('cf-connecting-ip')??'unknown'});
    if(!success)return new Response(null,{status:429,headers:{...headers,'retry-after':'60'}});
    return await storePlaytestRun(request,env.PLAYTEST_RUNS,headers);
  }catch{
    return new Response(null,{status:503,headers});
  }
}

async function storePlaytestRun(request:Request,kv:Env['PLAYTEST_RUNS'],headers:Record<string,string>){
  let value:unknown;
  try{
    const body=await readBody(request,maxBytes);
    if(body===undefined)return new Response(null,{status:413,headers});
    value=JSON.parse(body);
  }catch{
    return new Response(null,{status:400,headers});
  }
  if(!isCompletedPlaytestRun(value))return new Response(null,{status:400,headers});

  const key='run:'+value.runId;
  const serialized=JSON.stringify(value);
  const stored=await kv.get(key);
  if(stored!==null)return new Response(null,{status:stored===serialized?204:409,headers});
  await kv.put(key,serialized);
  return new Response(null,{status:201,headers});
}

export default {fetch:receivePlaytestRun};
