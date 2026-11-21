import test from 'node:test';
import assert from 'node:assert/strict';
import {newRun,startBattle,step,commitRoll} from '../src/engine.ts';
import {makeUnit} from '../src/battle/unit-state.ts';
import {spawnActor,queueSkill} from '../src/battle/combat.ts';
import {COMBAT,profile} from '../src/battle/model.ts';
import {actorFeedback,frameMessage,playbackFrames,wheelCues} from '../src/playback.ts';
import {COMBAT_TICK_MS,EFFECT_MS} from '../src/timing.ts';
import {resolveMovement,distance} from '../src/battle/movement.ts';

function scenario(allies,enemies){
  const run=newRun(365);
  run.roster=allies.map(([kind])=>kind);
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


test('independent strikes and movement share one fixed playback beat',()=>{
  const {battle}=scenario([
    ['archer',385,210],['archer',400,280],['guard',255,529],
  ],[
    ['guard',493,302],['bone',484,160],['orc',780,522],
  ]);
  const actors=battle.runtime.actors;
  Object.assign(actors['0-0'],{phase:'windup',readyAt:1,targetId:'1-0'});
  Object.assign(actors['0-1'],{phase:'windup',readyAt:1,targetId:'1-0'});
  Object.assign(actors['1-1'],{phase:'windup',readyAt:1,targetId:'0-0'});
  const result=step(battle);
  const frames=playbackFrames(result);
  const frame=frames[0];
  const attacks=frame.moments.filter(m=>m.action==='attack');
  assert.deepEqual(attacks.map(hit=>hit.source),['1-1','0-0','0-1']);
  assert.ok(frame.moments.some(m=>m.phase==='移动'));
  assert.ok(frame.state.runtime.actors['0-2'].position.x>actors['0-2'].position.x);
  assert.equal(frame.duration,COMBAT_TICK_MS);
  assert.deepEqual(frameMessage(frame),{phase:'攻击',text:'3 名单位出手。'});
  const cues=actorFeedback(frame.moments);
  for(const hit of attacks)assert.equal(cues.get(hit.source).attack,true);
  assert.equal(cues.get('1-0').damage,6);
  assert.equal(cues.get('0-0').damage,2);
  assert.deepEqual(frames.flatMap(frame=>frame.moments),result.events);
  assert.deepEqual(frames,playbackFrames(step(JSON.parse(JSON.stringify(battle)))));
});

test('quiet combat ticks keep their cadence without adding playback time per action',()=>{
  const {battle}=scenario([['guard',480,320]],[['orc',568,320]]);
  const frames=playbackFrames(step(battle));
  assert.equal(frames.length,COMBAT.ticksPerRoll);
  assert.ok(frames.some(frame=>frame.moments.length===0));
  assert.deepEqual(frames.map(frame=>frame.state.runtime.tick),Array.from({length:COMBAT.ticksPerRoll},(_,i)=>i+1));
  assert.ok(frames.every(frame=>frame.duration===COMBAT_TICK_MS));
});


test('rolls with deployments and spells use the same uninterrupted combat cadence',()=>{
  const run=newRun(22);
  run.roster=['guard','guard','soldier','wizard','medic'];
  run.spells=['surge','recruit'];
  startBattle(run);
  for(const unit of run.battle.units)unit.shield=100;
  for(let i=0;i<2;i++){
    const battle=run.battle,result=step(battle);
    const frames=playbackFrames(result);
    const first=frames[0];
    assert.equal(first.state.runtime.tick,battle.runtime.tick+1);
    assert.ok(first.moments.some(moment=>moment.phase==='停盘'));
    assert.ok(first.moments.some(moment=>moment.phase==='移动'));
    assert.equal(frames.length,10);
    assert.equal(result.outcome,undefined);
    assert.equal(frames.reduce((ms,frame)=>ms+frame.duration,0),result.ticks.length*COMBAT_TICK_MS);
    assert.deepEqual(frames.flatMap(frame=>frame.moments),result.events);
    assert.deepEqual(frames.at(-1).state,result.next);
    if(i===0){
      assert.ok(first.moments.some(moment=>moment.phase==='召唤'));
      const motions=wheelCues(first).map(cue=>cue.motion);
      assert.ok(wheelCues(first).every(cue=>cue.moment.phase!=='停盘'));
      assert.equal(motions.filter(motion=>motion==='cast').length,2);
      assert.ok(motions.includes('orbit'));
    }
    commitRoll(run,result);
  }
});

test('a wheel spell that ends the battle yields one terminal frame with its original cue',()=>{
  const {battle}=scenario([['guard',200,320]],[['orc',800,320]]);
  battle.spells=[{id:'spell-0',kind:'fireball'}];
  const result=step(battle);
  assert.equal(result.outcome,'胜利');
  assert.equal(result.ticks.length,0);
  const [frame]=playbackFrames(result);
  assert.equal(playbackFrames(result).length,1);
  assert.deepEqual(frame.state,result.next);
  assert.deepEqual(frame.moments,result.events);
  assert.equal(frame.duration,EFFECT_MS);
  const cast=wheelCues(frame).find(cue=>cue.motion==='cast');
  assert.ok(cast.moment.state.boards[0].includes('spell-0'));
  assert.ok(!frame.state.boards[0].includes('spell-0'));
  const defeated=actorFeedback(frame.moments).get('1-0');
  assert.equal(defeated.hit,true);
  assert.equal(defeated.death,true);
});


test('a wheel draw without any skills leaves occupied tiles unlit',()=>{
  const {battle}=scenario([['guard',200,320]],[['orc',800,320]]);
  const [frame]=playbackFrames(step(battle));
  const draw=frame.moments.find(moment=>moment.phase==='停盘');
  assert.deepEqual(draw.focus,['0-0','1-0']);
  assert.deepEqual(wheelCues(frame),[]);
  assert.equal(actorFeedback(frame.moments).size,0);
});

test('replay can use the recorded roll length across cadence changes',()=>{
  const run=scenario([['guard',300,320]],[['orc',700,320]]);
  const earlier=step(run.battle,{tickLimit:6});
  commitRoll(run,earlier);
  const restored=JSON.parse(JSON.stringify(run));
  const checkpoint=restored.history[0];
  const ticks=restored.battle.runtime.tick-checkpoint.runtime.tick;
  assert.equal(ticks,6);
  assert.deepEqual(step(checkpoint,{tickLimit:ticks}),earlier);
  assert.equal(playbackFrames(step(checkpoint)).length,10);
});
