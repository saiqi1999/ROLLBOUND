import assert from 'node:assert/strict';
import test from 'node:test';
import {encounters} from '../src/data.ts';
import {advance,newRun,startBattle} from '../src/engine.ts';
import {BATTLE_RULESET} from '../src/lineup-log.ts';
import {finishedPlaytestRun,recordPlaytestBattle} from '../src/playtest-run.ts';
import {receivePlaytestRun} from '../src/server/playtest-worker.ts';
import {recruit} from '../src/shop/rules.ts';

const origin='https://saiqi1999.github.io';
const endpoint='https://playtest.example/api/lineup-runs';
const timestamp=1795478400000;

function finishBattle(run,result){
  assert.ok(startBattle(run));
  run.lineupRunId='a'.repeat(32);
  const opening=run.battle;
  opening.lineupLog={
    id:(run.stage+1).toString(16).padStart(32,'0'),startedAt:timestamp+run.stage,ruleset:BATTLE_RULESET,
  };
  run.history=[opening];
  run.battle={...opening,runtime:{...opening.runtime,tick:100}};
  run.results[run.stage]=result;
  run.phase=result==='胜利'?'result':'end';
  recordPlaytestBattle(run,timestamp+10);
}

function finishedRun(){
  const run=newRun(32);
  recruit(run,'soldier');
  finishBattle(run,'胜利');
  advance(run);
  finishBattle(run,'落败');
  return run;
}

function storage(limited=false){
  const rows=new Map();
  let writes=0;
  const env={
    PLAYTEST_ORIGIN:origin,
    PLAYTEST_LIMITER:{async limit(){return {success:!limited};}},
    PLAYTEST_RUNS:{
      async get(key){return rows.get(key)??null;},
      async put(key,value){writes++;rows.set(key,value);},
    },
  };
  return {env,rows,writes:()=>writes};
}

function request(value,{method='POST',source=origin}={}){
  return new Request(endpoint,{method,headers:{origin:source,'content-type':'application/json'},
    body:method==='POST'?JSON.stringify(value):undefined});
}

test('playtest capture survives an in-progress save and prepares one report at the end',()=>{
  let run=newRun(32);
  recruit(run,'soldier');
  finishBattle(run,'胜利');
  assert.equal(finishedPlaytestRun(run),undefined);
  run=JSON.parse(JSON.stringify(run));
  advance(run);
  finishBattle(run,'落败');
  const report=finishedPlaytestRun(run);
  assert.deepEqual(report.battles.map(battle=>[battle.round,battle.result]),[[1,'win'],[2,'loss']]);
  recordPlaytestBattle(run,timestamp+99);
  assert.deepEqual(finishedPlaytestRun(run),report);
  run.playtest={uploaded:true};
  recordPlaytestBattle(run);
  assert.equal(finishedPlaytestRun(run),undefined);
});

test('the final victory is eligible before the player clicks through to the run summary',()=>{
  const run=newRun(12);
  run.stage=encounters.length-1;
  recruit(run,'soldier');
  finishBattle(run,'胜利');
  assert.equal(run.phase,'result');
  assert.equal(finishedPlaytestRun(run).battles[0].round,encounters.length);
});

test('the Worker accepts the Pages origin and stores retries under one key',async()=>{
  const {env,rows,writes}=storage();
  const report=finishedPlaytestRun(finishedRun());
  const preflight=await receivePlaytestRun(request(null,{method:'OPTIONS'}),env);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  assert.equal((await receivePlaytestRun(request(report),env)).status,201);
  assert.equal((await receivePlaytestRun(request(report),env)).status,204);
  assert.equal((await receivePlaytestRun(request({...report,finishedAt:report.finishedAt+1}),env)).status,409);
  assert.deepEqual(JSON.parse(rows.get('run:'+report.runId)),report);
  assert.equal(writes(),1);
});

test('the Worker rejects foreign origins, read requests, and payloads with unrelated fields',async()=>{
  const {env,rows}=storage();
  const report=finishedPlaytestRun(finishedRun());
  assert.equal((await receivePlaytestRun(request(report,{source:'https://elsewhere.test'}),env)).status,403);
  assert.equal((await receivePlaytestRun(request(null,{method:'GET'}),env)).status,405);
  assert.equal((await receivePlaytestRun(request({...report,extra:'unknown'}),env)).status,400);
  assert.equal((await receivePlaytestRun(request({...report,battles:[report.battles[0]]}),env)).status,400);
  assert.equal((await receivePlaytestRun(request(report),storage(true).env)).status,429);
  assert.equal(rows.size,0);
});
