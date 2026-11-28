import assert from 'node:assert/strict';
import test from 'node:test';
import {encounters} from '../src/data.ts';
import {advance,currentAttack,maxHealth,newRun,startBattle} from '../src/engine.ts';
import {BATTLE_RULESET} from '../src/lineup-log.ts';
import {needsMirrorLineups,saveMissingMirrorLineups} from '../src/mirror-lineups.ts';
import {finishedPlaytestRun,recordPlaytestBattle} from '../src/playtest-run.ts';
import {PlaytestArchive,receivePlaytestRun} from '../src/server/playtest-worker.ts';
import {digestOf,legacyRunKey,playtestArchiveKey,playtestRunPrefix,runKey} from '../src/server/playtest-archive.ts';
import {approvedMirrorsKey,mirrorManifestKey,mirrorRefreshKey} from '../src/server/match-mirrors.ts';
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
  const states=new Map();
  const objects=new Map();
  const reads=[];
  let writes=0;
  let rejectedKey;
  let unlistedKey;
  const env={
    PLAYTEST_ORIGIN:origin,
    PLAYTEST_LIMITER:{async limit(){return {success:!limited};}},
    PLAYTEST_RUNS:{
      async get(key){
        reads.push(...(Array.isArray(key)?key:[key]));
        return Array.isArray(key)?new Map(key.map(name=>[name,rows.get(name)??null])):rows.get(key)??null;
      },
      async list({prefix,limit,cursor}){
        const eligible=[...rows.keys()].sort().filter(key=>key.startsWith(prefix)&&key!==unlistedKey&&(!cursor||key>cursor));
        const keys=eligible.slice(0,limit).map(name=>({name}));
        return {list_complete:eligible.length<=limit,keys,cursor:keys.at(-1)?.name};
      },
      async put(key,value){
        if(key===rejectedKey)throw Error('KV write failed.');
        writes++;rows.set(key,value);
      },
      async delete(key){rows.delete(key);},
    },
  };
  env.PLAYTEST_ARCHIVE={getByName(name){
    if(!states.has(name))states.set(name,new Map());
    const state=states.get(name);
    if(!objects.has(name))objects.set(name,new PlaytestArchive({storage:{
      async get(key){return state.get(key);},
      async put(key,value){state.set(key,value);},
    }},env));
    return objects.get(name);
  }};
  return {env,rows,reads,restart:()=>objects.clear(),writes:()=>writes,rejectPut:key=>{rejectedKey=key;},
    hideFromList:key=>{unlistedKey=key;}};
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

test('a replay uses its original timestamped archive key even after a writer restart',async()=>{
  const {env,rows,restart,writes}=storage();
  const report=finishedPlaytestRun(finishedRun());
  const preflight=await receivePlaytestRun(request(null,{method:'OPTIONS'}),env);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  assert.equal((await receivePlaytestRun(request(report),env)).status,201);
  restart();
  const key=runKey(report);
  assert.deepEqual([...rows.keys()],[key]);
  assert.deepEqual(JSON.parse(rows.get(key)),report);
  rows.delete(key); // Simulate reading KV from a cold location.
  assert.equal((await receivePlaytestRun(request(report),env)).status,204);
  assert.equal((await receivePlaytestRun(request({...report,finishedAt:report.finishedAt+1}),env)).status,409);
  assert.equal(rows.size,0);
  assert.equal(writes(),1);
});

test('the Pages export downloads complete runs without including the approved mirror pack',async()=>{
  const {env,rows,writes}=storage();
  const run=finishedPlaytestRun(finishedRun());
  const url='https://playtest.example/api/playtest-export';
  const download=()=>receivePlaytestRun(new Request(url,{headers:{origin}}),env);
  rows.set(runKey(run),JSON.stringify(run));
  rows.set(approvedMirrorsKey,JSON.stringify({schemaVersion:1,opponents:[{runId:run.runId,rounds:[4]}]}));
  assert.deepEqual((await (await download()).json()).runs,{[run.runId]:run});

  const response=await download();
  assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal(response.headers.get('content-disposition'),'attachment; filename="rollbound-playtest-all.json"');
  assert.deepEqual(await response.json(),{schemaVersion:1,revision:0,runs:{[run.runId]:run},migrationComplete:true});
  assert.equal((await receivePlaytestRun(new Request(url,{headers:{origin:'https://elsewhere.test'}}),env)).status,403);
  assert.equal(writes(),0);
});

test('concurrent same-timestamp uploads and both legacy formats converge on complete timestamped records',async()=>{
  const {env,rows,hideFromList,rejectPut,restart}=storage();
  const legacy=finishedPlaytestRun(finishedRun());
  const first=withRunId(legacy,'b'.repeat(32));
  const second=withRunId(legacy,'c'.repeat(32));
  const individual=withRunId(legacy,'d'.repeat(32));
  const original=JSON.stringify({schemaVersion:1,revision:5,runs:{[legacy.runId]:legacy,[individual.runId]:individual}});
  rows.set(playtestArchiveKey,original);
  rows.set(legacyRunKey(individual.runId),JSON.stringify(individual));
  rows.set(runKey(individual),JSON.stringify({runId:individual.runId}));
  assert.deepEqual((await Promise.all([first,second].map(report=>receivePlaytestRun(request(report),env))))
    .map(response=>response.status),[201,201]);
  assert.notEqual(runKey(first),runKey(second));
  const download=async()=>(await receivePlaytestRun(new Request('https://playtest.example/api/playtest-export',{headers:{origin}}),env)).json();
  const expected=Object.fromEntries([legacy,individual,first,second].map(run=>[run.runId,run]));
  rejectPut(runKey(individual));
  assert.deepEqual((await download()).runs,expected);
  assert.equal(rows.has(legacyRunKey(individual.runId)),true);
  rejectPut(undefined);
  const staged=await download();
  assert.deepEqual(staged.runs,expected);
  assert.equal(staged.migrationComplete,false);
  assert.equal(rows.has(legacyRunKey(individual.runId)),true);
  hideFromList(runKey(individual));
  await download();
  assert.equal(rows.has(legacyRunKey(individual.runId)),true);
  hideFromList(undefined);
  restart();
  await download();
  assert.equal(rows.has(legacyRunKey(individual.runId)),false);
  await download();
  assert.equal(rows.get(playtestArchiveKey),original);
  assert.deepEqual(JSON.parse(rows.get(runKey(legacy))),legacy);
  await download();
  const final=await download();
  assert.deepEqual(final,{schemaVersion:1,revision:0,runs:expected,migrationComplete:true});
  assert.equal(rows.size,4);
  assert.equal([...rows.keys()].every(key=>key.startsWith(playtestRunPrefix)),true);
  assert.equal((await receivePlaytestRun(request(legacy),env)).status,204);
  assert.equal((await receivePlaytestRun(request({...legacy,finishedAt:legacy.finishedAt+1}),env)).status,409);
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
  rows.set(runKey(report),JSON.stringify(report));
  const none=await receivePlaytestRun(mirrorRequest(),env);
  assert.deepEqual((await none.json()).rounds,{});
  const approval=JSON.stringify({schemaVersion:1,opponents:[{runId:report.runId,ruleset:BATTLE_RULESET,rounds:[4,5,7]}]});
  rows.set(approvedMirrorsKey,approval);
  rows.set(mirrorRefreshKey,String(timestamp+100));
  const mirrors=await (await receivePlaytestRun(mirrorRequest(),env)).json();
  assert.deepEqual(mirrors.rounds,{4:{starters:[veteran],reserves:[reserve]},7:{starters:[veteran],reserves:[reserve]}});
  assert.deepEqual(JSON.parse(rows.get(mirrorManifestKey)).counts,{[BATTLE_RULESET]:{4:1,5:1,7:1}});
  assert.deepEqual(JSON.parse(rows.get(runKey(report))),JSON.parse(JSON.stringify(report)));
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

test('empty and partial saved mirror lookups leave missing rounds eligible for a retry',()=>{
  const empty={ruleset:BATTLE_RULESET,rounds:{}};
  const fourth={starters:[{id:'0-0',kind:'soldier',atk:11,hp:21,armor:0}],reserves:[]};
  const seventh={starters:[{id:'0-0',kind:'orcRider',atk:51,hp:81,armor:0}],reserves:[]};
  const fresh={stage:0};
  assert.equal(saveMissingMirrorLineups(fresh,empty,1),false);
  assert.equal(fresh.mirrors,undefined);

  const resumed={stage:2,mirrors:structuredClone(empty)};
  assert.equal(needsMirrorLineups(resumed),true);
  assert.equal(saveMissingMirrorLineups(resumed,{...empty,rounds:{4:fourth}},3),true);
  assert.equal(needsMirrorLineups(resumed),true);
  assert.equal(saveMissingMirrorLineups(resumed,{...empty,rounds:{4:seventh,7:seventh}},4),true);
  assert.deepEqual(resumed.mirrors.rounds,{4:fourth,7:seventh});
  assert.equal(needsMirrorLineups(resumed),false);

  const pastFourth={stage:4,mirrors:structuredClone(empty)};
  saveMissingMirrorLineups(pastFourth,{...empty,rounds:{4:fourth,7:seventh}},5);
  assert.deepEqual(pastFourth.mirrors.rounds,{7:seventh});
});

test('refresh numbers each round from one and a failed rebuild keeps the previous generation active',async t=>{
  const {env,rows,reads,rejectPut,restart}=storage();
  const base=finishedPlaytestRun(finishedRun());
  const earlier={...base,battles:[{...base.battles[1],round:4}]};
  const later=withRunId({...earlier,finishedAt:earlier.finishedAt+10},'b'.repeat(32));
  const seventh=withRunId({...earlier,battles:[{...earlier.battles[0],round:7}]},'c'.repeat(32));
  for(const run of [earlier,later,seventh])rows.set(runKey(run),JSON.stringify(run));
  const approved=(...items)=>JSON.stringify({schemaVersion:1,opponents:items.map(([run,round])=>({
    runId:run.runId,ruleset:BATTLE_RULESET,rounds:[round],
  }))});
  rows.set(approvedMirrorsKey,approved([later,4],[earlier,4],[seventh,7]));
  rows.set(mirrorRefreshKey,String(timestamp+100));
  t.mock.method(Math,'random',()=>0.99);
  const match=async()=>await (await receivePlaytestRun(mirrorRequest(),env)).json();
  assert.deepEqual(Object.keys((await match()).rounds),['4','7']);
  const first=JSON.parse(rows.get(mirrorManifestKey));
  const fourth='approvedkey_version1:4:4:'+first.generation+':';
  assert.deepEqual(first.counts,{4:{4:2,7:1}});
  assert.equal(JSON.parse(rows.get(fourth+'1')).runId,earlier.runId);
  assert.equal(JSON.parse(rows.get(fourth+'2')).runId,later.runId);
  rows.set(mirrorManifestKey,JSON.stringify({...first,counts:{}}));
  restart();
  reads.length=0;
  assert.deepEqual(Object.keys((await match()).rounds),['4','7']);
  assert.equal(reads.includes(mirrorManifestKey),false);
  assert.equal(reads.includes(fourth+'2'),true);
  assert.equal(reads.includes(fourth+'1'),false);
  assert.equal(reads.some(key=>key.startsWith(playtestRunPrefix)),false);
  rows.set(mirrorManifestKey,JSON.stringify(first));

  rows.set(approvedMirrorsKey,approved([earlier,4]));
  assert.deepEqual(Object.keys((await match()).rounds),['4','7']);
  rows.set(mirrorRefreshKey,String(timestamp+200));
  rejectPut(mirrorManifestKey);
  assert.deepEqual(Object.keys((await match()).rounds),['4','7']);
  assert.deepEqual(JSON.parse(rows.get(mirrorManifestKey)),first);
  rejectPut(undefined);
  assert.deepEqual(Object.keys((await match()).rounds),['4']);
  const second=JSON.parse(rows.get(mirrorManifestKey));
  assert.notEqual(first.generation,second.generation);
  assert.deepEqual(second.counts,{4:{4:1}});
});

test('the Pages button applies the configured batch once, preserving existing approvals',async()=>{
  const {env,rows,restart,writes}=storage();
  const base=finishedPlaytestRun(finishedRun());
  const complete={...base,battles:[4,5,6,7].map(round=>({
    ...base.battles[0],round,battleId:String(round).padStart(32,'0'),result:'win',
  }))};
  const selected=[['b',[4]],['c',[5,6]],['d',[7]]].map(([id,rounds],index)=>({
    run:withRunId({...complete,finishedAt:complete.finishedAt+index},id.repeat(32)),rounds,
  }));
  const previous=withRunId(complete,'e'.repeat(32));
  const prior={runId:previous.runId,ruleset:BATTLE_RULESET,rounds:[4]};
  rows.set(runKey(previous),JSON.stringify(previous));
  rows.set(approvedMirrorsKey,JSON.stringify({schemaVersion:1,opponents:[prior]}));
  env.PLAYTEST_APPROVAL_BATCH={entries:await Promise.all(selected.map(async({run,rounds})=>({
    finishedAt:run.finishedAt,keyDigest:await digestOf(runKey(run)),ruleset:BATTLE_RULESET,rounds,
  })))};
  const approve=(body,source=origin)=>receivePlaytestRun(new Request('https://playtest.example/api/approve-playtests',{
    method:'POST',body,duplex:'half',headers:{origin:source},
  }),env);
  assert.equal((await approve('arbitrary lineup')).status,400);
  assert.equal((await approve(null,'https://elsewhere.test')).status,403);
  assert.equal((await approve()).status,503);
  assert.equal(writes(),0);
  for(const {run} of selected)rows.set(runKey(run),JSON.stringify(run));
  const emptyBody=new ReadableStream({start(controller){controller.close();}});
  const responses=await Promise.all([approve(),approve(emptyBody)]);
  assert.deepEqual(responses.map(response=>response.status),[200,200]);
  const [result,repeated]=await Promise.all(responses.map(response=>response.json()));
  assert.deepEqual(repeated,result);
  assert.equal(result.runs,3);
  assert.equal(result.lineups,4);
  assert.deepEqual(result.manifest.counts,{[BATTLE_RULESET]:{4:2,5:1,6:1,7:1}});
  assert.deepEqual(JSON.parse(rows.get(approvedMirrorsKey)).opponents,[prior,...selected.map(({run,rounds})=>({
    runId:run.runId,ruleset:BATTLE_RULESET,rounds,
  }))]);
  for(const {run,rounds} of selected){
    for(const round of rounds){
      const slots=[...rows].filter(([key])=>key.startsWith(`approvedkey_version1:${BATTLE_RULESET}:${round}:${result.manifest.generation}:`));
      assert.ok(slots.some(([,value])=>JSON.parse(value).runId===run.runId));
    }
  }
  restart();
  assert.deepEqual(await (await approve()).json(),result);
  assert.equal(writes(),7);
  const live=await (await receivePlaytestRun(mirrorRequest(),env)).json();
  assert.deepEqual(Object.keys(live.rounds),['4','7']);
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
