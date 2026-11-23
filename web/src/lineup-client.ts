import type {Run} from './engine.ts';
import {captureLineup} from './lineup-log.ts';

export const lineupLogging=import.meta.env.VITE_LINEUP_LOGGING==='1';
const prefix='rollbound.lineup.pending.';
const endpoint='./api/battle-lineups';
const unsent=new Map<string,string>();
let sending=false;

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

export async function flushLineupLogs(){
  if(!lineupLogging||sending)return;
  sending=true;
  try{
    const attempted=new Map<string,string>();
    for(;;){
      const batch=[...pendingLineups()].filter(([key,body])=>attempted.get(key)!==body);
      if(!batch.length)return;
      for(const [key,body] of batch){
        attempted.set(key,body);
        try{
          const response=await fetch(endpoint,{
            method:'POST',headers:{'content-type':'application/json'},body,keepalive:body.length<65536,
          });
          if(response.status===400||response.status===413)continue;
          if(!response.ok)return;
        }catch{return;}
        if(unsent.get(key)===body)unsent.delete(key);
        try{
          if(localStorage.getItem(key)===body)localStorage.removeItem(key);
        }catch{/* The server accepts repeat submissions under the original battle ID. */}
      }
    }
  }finally{sending=false;}
}
