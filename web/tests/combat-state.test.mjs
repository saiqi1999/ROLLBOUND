import test from 'node:test';
import assert from 'node:assert/strict';
import {newRun,startBattle,step,commitRoll} from '../src/engine.ts';
import {makeUnit} from '../src/battle/unit-state.ts';
import {spawnActor,queueSkill} from '../src/battle/combat.ts';
import {COMBAT,profile} from '../src/battle/model.ts';
import {resolveMovement,distance} from '../src/battle/movement.ts';

function scenario(allies,enemies){
  const run=newRun(365);
  startBattle(run);
  const battle=run.battle;
  battle.round=1;
  battle.units=[allies,enemies].flatMap((team,side)=>team.map(([kind,x,y],index)=>{
    const unit=makeUnit(kind,side,index,0,0);
    unit.field=true;
    spawnActor(battle,unit);
    battle.runtime.actors[unit.id].position={x,y};
    return unit;
  }));
  return run;
}

test('both sides move from the same snapshot without passing through each other',()=>{
  const p=[{x:300,y:300},{x:420,y:300}];
  const v=[{x:100,y:0},{x:-100,y:0}];
  const [left,right]=resolveMovement(p,v);
  assert.equal(left.x+right.x,720);
  assert.equal(right.x-left.x,COMBAT.separation);
  assert.deepEqual(resolveMovement(p.toReversed(),v.toReversed()).toReversed(),[left,right]);
  assert.deepEqual(p,[{x:300,y:300},{x:420,y:300}]);
});

test('the deployed fighter outside the current wheel still attacks in range',()=>{
  const {battle}=scenario(Array.from({length:9},(_,i)=>['guard',200,82+i*62]).concat([['archer',445,270]]),[['orc',554,270]]);
  // One of the nine other pieces is already a corpse and reserves a draw slot.
  battle.units[0].hp=0;
  battle.units[0].field=false;
  battle.runtime.actors['0-0'].phase='dead';
  for(let seed=0;seed<50;seed++){
    battle.rng=Math.imul(seed,0x9e3779b1)>>>0;
    const {next,events}=step(battle);
    if(next.boards[0].includes('0-9'))continue;
    const hit=events.find(e=>e.action==='attack'&&e.source==='0-9');
    assert.equal(hit?.target,'1-0');
    assert.equal(hit.value,'−3');
    return;
  }
  assert.fail('no sample where a deployed unit missed the draw');
});

test('a queued link retains its original neighbors and order across wheel rolls and reload',()=>{
  const run=scenario([['archer',315,125],['guard',367,300],['lancer',310,452]], [['orc',670,335]]);
  const battle=run.battle;
  const [archer]=battle.units;
  const actor=battle.runtime.actors[archer.id];
  actor.phase='recover';
  actor.readyAt=COMBAT.ticksPerRoll+2;
  queueSkill(battle,archer,['0-1']);
  const first=step(battle);
  assert.equal(first.events.some(e=>e.phase==='联动'),false);
  assert.ok(first.events.some(e=>e.phase==='移动')); // A separate unit continues its normal pursuit.
  assert.equal(first.next.runtime.actors[archer.id].queue[0].originRoll,1);
  commitRoll(run,first);
  const loaded=JSON.parse(JSON.stringify(run));
  const result=step(loaded.battle);
  assert.deepEqual(step(run.battle),result);
  assert.deepEqual(step(loaded.battle,{captureEvents:false}).next,result.next);
  const links=result.events.filter(e=>e.phase==='联动');
  assert.equal(links[0].source,archer.id);
  assert.equal(links[0].originRoll,1);
  assert.deepEqual(links[0].focus,['0-0','0-1']);
  assert.deepEqual(links.map(e=>e.originRoll),links.map(e=>e.originRoll).sort((a,b)=>a-b));
  assert.ok(links.some(e=>e.originRoll===2));
});

test('a waiting link is dropped if its original neighbor dies and a later hit cannot target the corpse',()=>{
  const {battle}=scenario([['archer',375,130],['guard',470,300]], [['orc',560,300]]);
  const [archer,guard,orc]=battle.units;
  guard.hp=1;
  const archerActor=battle.runtime.actors[archer.id];
  archerActor.phase='recover';
  archerActor.readyAt=3;
  Object.assign(battle.runtime.actors[orc.id],{phase:'windup',readyAt:1,targetId:guard.id});
  queueSkill(battle,archer,[guard.id]);
  const {next,events}=step(battle);
  assert.equal(next.units[0].bonus,0);
  assert.equal(next.units[1].hp,0);
  assert.equal(events.filter(e=>e.action==='attack'&&e.target===guard.id).length,1);
  assert.ok(!events.some(e=>e.phase==='联动'&&e.source===archer.id));
});

test('bone link grants one hit of bonus damage and movement stays outside other fighters',()=>{
  const {battle}=scenario([['bone',340,320],['orc',273,320]], [['guard',570,322]]);
  const [bone,,guard]=battle.units;
  guard.hp=160;
  queueSkill(battle,bone,['0-1']);
  const first=step(battle);
  const hit=first.events.find(e=>e.action==='attack'&&e.source===bone.id);
  assert.equal(hit?.value,'−4');
  assert.equal(hit.state.units[0].nextAttackBonus,undefined);
  const guardActor=battle.runtime.actors[guard.id];
  const approaching=battle.runtime.actors['0-1'];
  assert.ok(distance(guardActor.position,approaching.position)>profile('orc').range);
  for(const event of first.events.filter(e=>e.phase==='移动')){
    const positions=Object.values(event.state.runtime.actors).map(actor=>actor.position);
    for(let i=0;i<positions.length;i++)for(const other of positions.slice(i+1)){
      assert.ok(distance(positions[i],other)>=COMBAT.separation-1e-6);
    }
  }
});

test('wheel, targeting and effect random streams are independent',()=>{
  const {battle}=scenario([['guard',120,100],['archer',120,200]], [['orc',800,150],['orc',800,330]]);
  const alternate=structuredClone(battle);
  alternate.runtime.rng=2**29;
  alternate.runtime.effectRandom.rng=0xffffffff;
  const base=step(battle),changed=step(alternate);
  assert.deepEqual(base.events[0].state.boards,changed.events[0].state.boards);
  assert.equal(base.next.rng,changed.next.rng);
});
