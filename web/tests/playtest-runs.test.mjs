import assert from 'node:assert/strict';
import test from 'node:test';
import {encounters} from '../src/data.ts';
import {advance,currentAttack,maxHealth,newRun,startBattle} from '../src/engine.ts';
import {BATTLE_RULESET} from '../src/lineup-log.ts';
import {finishedPlaytestRun,recordPlaytestBattle} from '../src/playtest-run.ts';
import {PlaytestArchive,receivePlaytestRun} from '../src/server/playtest-worker.ts';
import {playtestArchiveKey} from '../src/server/playtest-archive.ts';
import {approvedMirrorsKey} from '../src/server/match-mirrors.ts';
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
  const state=new Map();
  let writes=0;
  const env={
    PLAYTEST_ORIGIN:origin,
    PLAYTEST_LIMITER:{async limit(){return {success:!limited};}},
    PLAYTEST_RUNS:{
      async get(key){
        return Array.isArray(key)?new Map(key.map(name=>[name,rows.get(name)??null])):rows.get(key)??null;
      },
      async list({prefix}){return {list_complete:true,keys:[...rows.keys()].filter(key=>key.startsWith(prefix)).map(name=>({name}))};},
      async put(key,value){writes++;rows.set(key,value);},
    },
  };
  function restart(){
    const archive=new PlaytestArchive({storage:{
      async get(key){return state.get(key);},
      async put(key,value){state.set(key,value);},
    }},env);
    env.PLAYTEST_ARCHIVE={getByName:()=>archive};
  }
  restart();
  return {env,rows,restart,writes:()=>writes};
}

function request(value,{method='POST',source=origin}={}){
  return new Request(endpoint,{method,headers:{origin:source,'content-type':'application/json'},
    body:method==='POST'?JSON.stringify(value):undefined});
}

function mirrorRequest(ruleset=BATTLE_RULESET){
  return new Request(`https://playtest.example/api/mirrors?ruleset=${ruleset}`,{headers:{origin}});
}

function withRunId(report,runId){
  return {...report,runId,battles:report.battles.map(battle=>({...battle,runId}))};
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

test('the Worker accepts the Pages origin and deduplicates retries in the full archive',async()=>{
  const {env,rows,writes}=storage();
  const report=finishedPlaytestRun(finishedRun());
  const preflight=await receivePlaytestRun(request(null,{method:'OPTIONS'}),env);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  assert.equal((await receivePlaytestRun(request(report),env)).status,201);
  assert.equal((await receivePlaytestRun(request(report),env)).status,204);
  assert.equal((await receivePlaytestRun(request({...report,finishedAt:report.finishedAt+1}),env)).status,409);
  assert.deepEqual([...rows.keys()],[playtestArchiveKey]);
  assert.deepEqual(JSON.parse(rows.get(playtestArchiveKey)).runs[report.runId],report);
  assert.equal(writes(),1);
});

test('concurrent uploads keep legacy and new runs together and a cold writer rejects a stale revision',async()=>{
  const {env,rows,restart}=storage();
  const legacy=finishedPlaytestRun(finishedRun());
  const first=withRunId(legacy,'b'.repeat(32));
  const second=withRunId(legacy,'c'.repeat(32));
  rows.set('run:'+legacy.runId,JSON.stringify(legacy));
  assert.deepEqual((await Promise.all([first,second].map(report=>receivePlaytestRun(request(report),env))))
    .map(response=>response.status),[201,201]);
  const complete=rows.get(playtestArchiveKey);
  const archive=JSON.parse(complete);
  assert.deepEqual(archive.runs,{[legacy.runId]:legacy,[first.runId]:first,[second.runId]:second});
  assert.equal(rows.size,2);
  rows.set(playtestArchiveKey,JSON.stringify({...archive,revision:archive.revision-1,runs:{[legacy.runId]:legacy}}));
  restart();
  assert.equal((await receivePlaytestRun(request(second),env)).status,503);
  assert.equal(JSON.parse(rows.get(playtestArchiveKey)).revision,archive.revision-1);
  rows.set(playtestArchiveKey,complete);
  assert.equal((await receivePlaytestRun(request(second),env)).status,204);
});

test('manual approvals serve only the selected rounds and restore mirrored stats and reserves',async()=>{
  const {env,rows}=storage();
  const base=finishedPlaytestRun(finishedRun());
  const veteran={id:'0-0',kind:'demon',atk:25,hp:47,armor:9,tag:'clone'};
  const copy={...veteran,id:'0-0-clone',tag:undefined,cloneOf:'0-0'};
  const reserve={id:'0-1',kind:'soldier',atk:8,hp:17,armor:3,tag:'double'};
  const report={...base,battles:[4,5,6,7].map(round=>({
    ...base.battles[0],round,battleId:String(round).padStart(32,'0'),
    lineup:{starters:[veteran,copy],reserves:[reserve]},result:'win',
  }))};
  rows.set('run:'+report.runId,JSON.stringify(report));
  const none=await receivePlaytestRun(mirrorRequest(),env);
  assert.deepEqual((await none.json()).rounds,{});
  const approval=JSON.stringify({schemaVersion:1,opponents:[{runId:report.runId,ruleset:BATTLE_RULESET,rounds:[4,5,7]}]});
  rows.set(approvedMirrorsKey,approval);
  const mirrors=await (await receivePlaytestRun(mirrorRequest(),env)).json();
  assert.deepEqual(mirrors.rounds,{4:{starters:[veteran],reserves:[reserve]},7:{starters:[veteran],reserves:[reserve]}});
  assert.deepEqual((await (await receivePlaytestRun(mirrorRequest(BATTLE_RULESET-1),env)).json()).rounds,{});
  assert.equal((await receivePlaytestRun(request(report),env)).status,204);
  assert.equal(rows.get(approvedMirrorsKey),approval);

  for(const round of [3,4,7]){
    const run=newRun(90);
    run.mirrors=JSON.parse(JSON.stringify(mirrors));
    run.stage=round-1;
    recruit(run,'soldier');
    assert.ok(startBattle(run));
    const enemies=run.battle.units.filter(unit=>unit.side===1);
    if(round===3){
      assert.deepEqual(enemies.map(unit=>unit.kind),encounters[run.stage].units);
      continue;
    }
    const [starter,backup,clone]=enemies;
    assert.deepEqual([currentAttack(starter),maxHealth(starter),starter.shield,starter.tag,starter.field],[25,47,9,'clone',true]);
    assert.deepEqual([currentAttack(backup),maxHealth(backup),backup.shield,backup.tag,backup.field],[8,17,3,'double',false]);
    assert.deepEqual(run.battle.reserves[1],[backup.id]);
    assert.equal(enemies.length,3);
    assert.equal(clone.cloneOf,starter.id);
  }
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
