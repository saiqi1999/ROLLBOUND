import type {Run} from './engine.ts';
import {BATTLE_RULESET} from './battle/model.ts';
import {lineupLogging} from './lineup-client.ts';
import {isMirrorBundle} from './mirror-lineups.ts';
import {finishedPlaytestRun} from './playtest-run.ts';

const endpoint=import.meta.env.VITE_PLAYTEST_RUNS_URL?.trim();
export const playtestEnabled=Boolean(endpoint)&&!lineupLogging;
const sending=new WeakSet<Run>();

export async function downloadPlaytestArchive(){
  if(!playtestEnabled||!endpoint)throw Error('Playtest export is unavailable.');
  const url=new URL('playtest-export',new URL(endpoint,window.location.href));
  const response=await fetch(url,{
    credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),
  });
  if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json')){
    throw Error('Unable to download the playtest archive.');
  }

  const downloadUrl=URL.createObjectURL(await response.blob());
  const link=document.createElement('a');
  link.href=downloadUrl;
  link.download='rollbound-playtest-all.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(downloadUrl),1000);
}

export async function loadMirrors(){
  if(!playtestEnabled||!endpoint)return;
  try{
    const url=new URL('mirrors',new URL(endpoint,window.location.href));
    url.searchParams.set('ruleset',String(BATTLE_RULESET));
    const response=await fetch(url,{
      credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(3000),
    });
    if(!response.ok)return;
    const bundle:unknown=await response.json();
    if(isMirrorBundle(bundle))return bundle;
  }catch{
    // A run can continue with its built-in encounters while the mirror service is unavailable.
  }
}

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
