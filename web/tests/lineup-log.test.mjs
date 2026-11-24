import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {commitBattleWindow,newRun,simulateBattleWindow,startBattle} from '../src/engine.ts';
import {BATTLE_RULESET,captureLineup} from '../src/lineup-log.ts';
import {handleLineups} from '../src/server/lineups.ts';
import {recruit} from '../src/shop/rules.ts';

const origin='https://playtest.example';
const endpoint=origin+'/api/battle-lineups';
const runId='a'.repeat(32);

function startLoggedBattle(run,id='b'.repeat(32)){
  assert.ok(startBattle(run));
  run.lineupRunId=runId;
  run.battle.lineupLog={id,startedAt:1795478400000,ruleset:BATTLE_RULESET};
}

test('lineup snapshots preserve older opening attack values and label new combat rules',()=>{
  const run=newRun(63);
  recruit(run,'orcRider',2);
  recruit(run,'armoredOrc',4);
  startLoggedBattle(run);
  const current=captureLineup(run);
  assert.equal(current.ruleset,2);
  assert.deepEqual(current.lineup.starters.map(unit=>unit.atk),[11,10]);
  delete run.battle.lineupLog.ruleset;
  const old=captureLineup(run);
  assert.equal(old.ruleset,1);
  assert.deepEqual(old.lineup.starters.map(unit=>unit.atk),[5,7]);
});

function database(t){
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(readFileSync(new URL('../../drizzle/0000_battle_lineups.sql',import.meta.url),'utf8'));
  return {DB:{prepare(sql){
    const statement=db.prepare(sql);
    return {bind(...args){
      return {async run(){return statement.run(...args);},async all(){return {results:statement.all(...args)};}};
    }};
  }}};
}

function request(method,body,extra={}){
  return new Request(endpoint,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{
    'oai-authenticated-user-id':'test-owner','content-type':'application/json',origin,...extra,
  }});
}

async function exportRows(env){
  const response=await handleLineups(request('GET'),env);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/rollbound-lineups.ndjson/);
  return (await response.text()).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
}

test('the opening record captures actual reserves, clones and applied growth before combat',()=>{
  const run=newRun(12);
  assert.equal(captureLineup(run),undefined);
  const originals=Array.from({length:18},()=>recruit(run,'guard',3,4));
  originals[0].tag='growth';
  for(const unit of originals.slice(1))unit.tag='clone';
  originals[1].startingArmor=3;
  run.shop.openingSpells.push({id:'fire-0',kind:'fireball'});
  startLoggedBattle(run);
  const opening=captureLineup(run);
  const {starters,reserves}=opening.lineup;
  assert.equal(starters.filter(unit=>!unit.cloneOf).length,16);
  assert.equal(reserves.length,2);
  assert.ok(starters.some(unit=>unit.cloneOf));
  assert.deepEqual(reserves.map(unit=>unit.id),run.battle.reserves[0]);
  assert.equal(opening.fireballs,1);
  assert.equal(opening.result,null);
  const byId=new Map([...starters,...reserves].map(unit=>[unit.id,unit]));
  assert.deepEqual(byId.get(originals[0].id),{id:originals[0].id,kind:'guard',atk:10,hp:21,armor:0,tag:'growth'});
  assert.equal(byId.get(originals[1].id).armor,3);

  while(run.phase==='battle')commitBattleWindow(run,simulateBattleWindow(run.battle,{captureEvents:false}));
  const result=captureLineup(JSON.parse(JSON.stringify(run)));
  assert.deepEqual(result.lineup,opening.lineup);
  assert.equal(result.result,'win');
  assert.ok(result.ticks>0);
});

test('server keeps one row and the first opening lineup across retries and an out-of-order result',async t=>{
  const env=database(t);
  const run=newRun(13);
  recruit(run,'archer',50);
  startLoggedBattle(run);
  const opening=captureLineup(run);
  const closing={...opening,result:'win',ticks:13};
  const differentLineup={...opening,lineup:{...opening.lineup,starters:[{...opening.lineup.starters[0],atk:99}]}};

  assert.equal((await handleLineups(request('POST',opening),env)).status,204);
  assert.equal((await handleLineups(request('POST',{...differentLineup,result:'loss',ticks:11}),env)).status,204);
  assert.deepEqual(await exportRows(env),[opening]);
  assert.equal((await handleLineups(request('POST',closing),env)).status,204);
  assert.equal((await handleLineups(request('POST',opening),env)).status,204);
  assert.equal((await handleLineups(request('POST',{...closing,result:'loss'}),env)).status,204);
  const anotherBattle={...closing,battleId:'c'.repeat(32),round:2};
  assert.equal((await handleLineups(request('POST',anotherBattle),env)).status,204);
  assert.deepEqual(await exportRows(env),[closing,anotherBattle]);
});

test('the server requires its site identity and only accepts same-origin structured submissions',async t=>{
  const env=database(t);
  const run=newRun(19);
  recruit(run,'guard');
  startLoggedBattle(run);
  const record=captureLineup(run);
  assert.equal((await handleLineups(new Request(endpoint),env)).status,401);
  assert.equal((await handleLineups(request('POST',record,{origin:'https://elsewhere.test'}),env)).status,403);
  assert.equal((await handleLineups(request('POST',{...record,round:0}),env)).status,400);
  assert.equal((await handleLineups(request('POST',{...record,ticks:2}),env)).status,400);
  assert.deepEqual(await exportRows(env),[]);
});

test('a signed-in mobile session can submit and export with the site-provided email alone',async t=>{
  const env=database(t);
  const run=newRun(42);
  recruit(run,'guard');
  startLoggedBattle(run);
  const record=captureLineup(run);
  const headers={'oai-authenticated-user-email':'playtester@example.test',origin,'content-type':'application/json'};
  const submitted=await handleLineups(new Request(endpoint,{method:'POST',headers,body:JSON.stringify(record)}),env);
  assert.equal(submitted.status,204);
  const exported=await handleLineups(new Request(endpoint,{headers}),env);
  assert.equal(exported.status,200);
  assert.deepEqual(JSON.parse(await exported.text()),record);
});

test('export streams all rows across query pages',async t=>{
  const env=database(t);
  const run=newRun(21);
  recruit(run,'guard');
  startLoggedBattle(run);
  const record=captureLineup(run);
  for(let index=0;index<132;index++){
    const row={...record,battleId:index.toString(16).padStart(32,'0')};
    assert.equal((await handleLineups(request('POST',row),env)).status,204);
  }
  assert.equal((await exportRows(env)).length,132);
});
