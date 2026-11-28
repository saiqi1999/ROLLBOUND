import {readBody} from './lineups.ts';
import {matchMirrors,type MirrorManifest} from './match-mirrors.ts';
import {isCompletedPlaytestRun,readArchive,type PlaytestKV} from './playtest-archive.ts';

export {isCompletedPlaytestRun} from './playtest-archive.ts';
export {PlaytestArchive} from './playtest-storage.ts';

type Env = {
  PLAYTEST_ORIGIN:string;
  PLAYTEST_RUNS:PlaytestKV;
  PLAYTEST_LIMITER:{limit(options:{key:string}):Promise<{success:boolean}>};
  PLAYTEST_ARCHIVE:{getByName(name:string):{fetch(request:Request):Promise<Response>}};
};

const maxBytes=512*1024;

export async function receivePlaytestRun(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  const exporting=url.pathname==='/api/playtest-export';
  const reading=exporting||url.pathname==='/api/mirrors';
  if(!reading&&url.pathname!=='/api/lineup-runs')return new Response(null,{status:404});
  const origin=request.headers.get('origin');
  if(!origin||origin!==env.PLAYTEST_ORIGIN)return new Response(null,{status:403});

  const headers={
    'access-control-allow-origin':origin,
    'cache-control':'no-store',
    vary:'Origin',
  };
  const method=reading?'GET':'POST';
  if(request.method==='OPTIONS'){
    return new Response(null,{status:204,headers:{
      ...headers,'access-control-allow-methods':method+', OPTIONS','access-control-allow-headers':'Content-Type',
      'access-control-max-age':'600',
    }});
  }
  if(request.method!==method)return new Response(null,{status:405,headers:{...headers,allow:method+', OPTIONS'}});
  if(!reading&&request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){
    return new Response(null,{status:415,headers});
  }
  if(Number(request.headers.get('content-length'))>maxBytes)return new Response(null,{status:413,headers});
  if(!env.PLAYTEST_RUNS||!env.PLAYTEST_LIMITER||!reading&&!env.PLAYTEST_ARCHIVE)return new Response(null,{status:503,headers});

  try{
    const ip=request.headers.get('cf-connecting-ip')??'unknown';
    const key=reading?url.pathname.slice('/api/'.length)+':'+ip:ip;
    const {success}=await env.PLAYTEST_LIMITER.limit({key});
    if(!success)return new Response(null,{status:429,headers:{...headers,'retry-after':'60'}});
    if(exporting){
      const migration=await env.PLAYTEST_ARCHIVE?.getByName('playtest-runs')
        .fetch(new Request('https://archive.internal/migrate',{method:'POST'})).catch(()=>undefined);
      const migrationComplete=migration?.status===204;
      const archive=await readArchive(env.PLAYTEST_RUNS,migrationComplete);
      return Response.json({...archive,migrationComplete},{headers:{
        ...headers,
        'content-disposition':'attachment; filename="rollbound-playtest-all.json"',
      }});
    }
    if(reading){
      const ruleset=Number(url.searchParams.get('ruleset'));
      if(!Number.isSafeInteger(ruleset)||ruleset<1)return new Response(null,{status:400,headers});
      const refresh=env.PLAYTEST_ARCHIVE?async(requestedAt:number)=>{
        const result=await env.PLAYTEST_ARCHIVE.getByName('approved-mirrors').fetch(new Request('https://archive.internal/refresh',{
          method:'POST',body:String(requestedAt),
        }));
        if(result.ok)return await result.json() as MirrorManifest;
      }:undefined;
      return Response.json(await matchMirrors(env.PLAYTEST_RUNS,ruleset,refresh),{headers});
    }
    return await storePlaytestRun(request,env.PLAYTEST_ARCHIVE,headers);
  }catch{
    return new Response(null,{status:503,headers});
  }
}

async function storePlaytestRun(request:Request,archive:Env['PLAYTEST_ARCHIVE'],headers:Record<string,string>){
  let value:unknown;
  try{
    const body=await readBody(request,maxBytes);
    if(body===undefined)return new Response(null,{status:413,headers});
    value=JSON.parse(body);
  }catch{
    return new Response(null,{status:400,headers});
  }
  if(!isCompletedPlaytestRun(value))return new Response(null,{status:400,headers});

  const result=await archive.getByName('playtest-runs').fetch(new Request('https://archive.internal/append',{
    method:'POST',body:JSON.stringify(value),
  }));
  const retryAfter=result.headers.get('retry-after');
  return new Response(null,{status:result.status,headers:retryAfter?{...headers,'retry-after':retryAfter}:headers});
}

export default {fetch:receivePlaytestRun};
