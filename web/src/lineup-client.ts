import type {Run} from './engine.ts';
import {captureLineup} from './lineup-log.ts';

export const lineupLogging=import.meta.env.VITE_LINEUP_LOGGING==='1';
const prefix='rollbound.lineup.pending.';
const endpoint='./api/battle-lineups';
const firstRetryDelay=2000;
const maxRetryDelay=30000;
const submitTimeout=10000;
const unsent=new Map<string,string>();
let sending=false;
let retryTimer:number|undefined,retryDelay=firstRetryDelay;

function newId(){
  return Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(16).padStart(8,'0')).join('');
}

export function startLineupLog(run:Run){
  if(!lineupLogging||!run.battle)return;
  run.lineupRunId??=newId();
  run.battle.lineupLog={id:newId(),startedAt:Date.now()};
}

export function queueLineup(run:Run){
  if(!lineupLogging)return;
  const record=captureLineup(run);
  if(!record)return;
  const key=prefix+record.battleId;
  const body=JSON.stringify(record);
  unsent.set(key,body);
  try{localStorage.setItem(key,body);}catch{/* A full save store still allows sending from memory. */}
  void flushLineupLogs();
}

function pendingLineups(){
  const pending=new Map(unsent);
  try{
    for(let index=0;index<localStorage.length;index++){
      const key=localStorage.key(index);
      if(!key?.startsWith(prefix))continue;
      const body=localStorage.getItem(key);
      if(body&&!pending.has(key))pending.set(key,body);
    }
  }catch{/* Browser storage can be unavailable while the page is still playable. */}
  return pending;
}

function retryLater(){
  if(retryTimer!==undefined)return;
  retryTimer=window.setTimeout(()=>{
    retryTimer=undefined;
    void flushLineupLogs();
  },retryDelay);
  retryDelay=Math.min(retryDelay*2,maxRetryDelay);
}

async function submitLineup(body:string){
  const request=new AbortController();
  const timeout=window.setTimeout(()=>request.abort(),submitTimeout);
  try{
    return await fetch(endpoint,{
      method:'POST',headers:{'content-type':'application/json'},body,
      keepalive:body.length<65536,signal:request.signal,
    });
  }finally{
    window.clearTimeout(timeout);
  }
}

export async function flushLineupLogs(){
  if(!lineupLogging||sending)return;
  window.clearTimeout(retryTimer);
  retryTimer=undefined;
  sending=true;
  try{
    const attempted=new Map<string,string>();
    for(;;){
      const batch=[...pendingLineups()].filter(([key,body])=>attempted.get(key)!==body);
      if(!batch.length)return;
      for(const [key,body] of batch){
        attempted.set(key,body);
        try{
          const response=await submitLineup(body);
          if(response.status===400||response.status===413)continue;
          if(!response.ok){
            if(response.status===408||response.status===429||response.status>=500)retryLater();
            return;
          }
        }catch{
          retryLater();
          return;
        }
        retryDelay=firstRetryDelay;
        if(unsent.get(key)===body)unsent.delete(key);
        try{
          if(localStorage.getItem(key)===body)localStorage.removeItem(key);
        }catch{/* The server accepts repeat submissions under the original battle ID. */}
      }
    }
  }finally{sending=false;}
}
