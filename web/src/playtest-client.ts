import type {Run} from './engine.ts';
import {lineupLogging} from './lineup-client.ts';
import {finishedPlaytestRun} from './playtest-run.ts';

const endpoint=import.meta.env.VITE_PLAYTEST_RUNS_URL?.trim();
export const playtestEnabled=Boolean(endpoint)&&!lineupLogging;
const sending=new WeakSet<Run>();

async function sendRun(endpoint:string,body:string,keepalive:boolean){
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(endpoint,{
      method:'POST',body,keepalive,credentials:'omit',redirect:'error',
      headers:{'content-type':'application/json'},signal:controller.signal,
    });
    return response.status;
  }catch{
    return 503;
  }finally{
    window.clearTimeout(timeout);
  }
}

export async function uploadFinishedPlaytest(run:Run,onUploaded:(run:Run)=>void){
  if(!playtestEnabled||!endpoint||sending.has(run))return;
  const report=finishedPlaytestRun(run);
  if(!report)return;

  const body=JSON.stringify(report);
  const keepalive=new TextEncoder().encode(body).byteLength<=60*1024;
  sending.add(run);
  try{
    for(const delay of [0,2000,5000]){
      if(delay)await new Promise<void>(resolve=>window.setTimeout(resolve,delay));
      const status=await sendRun(endpoint,body,keepalive);
      if(status===201||status===204){
        run.playtest={uploaded:true};
        onUploaded(run);
        return;
      }
      if(status!==408&&status!==429&&status<500)return;
    }
  }finally{
    sending.delete(run);
  }
}
