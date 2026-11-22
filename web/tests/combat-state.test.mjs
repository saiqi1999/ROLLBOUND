import test from 'node:test';
import assert from 'node:assert/strict';
import {advance,commitBattleWindow,newRun,removalMarkers,simulateBattleWindow,startBattle} from '../src/engine.ts';
import {createBattle} from '../src/battle/resolve.ts';
import {createEffects} from '../src/battle/effects.ts';
import {COMBAT,FIELD_LIMIT,profile} from '../src/battle/model.ts';
import {currentAttack,deployed,maxHealth} from '../src/battle/unit-state.ts';
import {distance,resolveMovement} from '../src/battle/movement.ts';
import {actorFeedback,frameMessage,playbackFrames} from '../src/playback.ts';
import {recruit,resolveSpin} from '../src/shop/rules.ts';
import {COMBAT_TICK_MS,EFFECT_MS} from '../src/timing.ts';

function scenario(allies,enemies){
  const run=newRun(365);
  const recruits=allies.map(([kind])=>recruit(run,kind));
  run.battle=createBattle({
    id:'test',seed:365,allies:recruits,enemies:enemies.map(([kind])=>({kind,attack:0,health:0})),
    preparations:run.shop.preparations,
  });
  run.phase='battle';
  for(const [side,team] of [allies,enemies].entries()){
    team.forEach(([,x,y],index)=>{
      const actor=run.battle.runtime.actors[side+'-'+index];
      if(actor&&x!==undefined)actor.position={x,y};
    });
  }
  return run;
}
const live=(battle,side)=>battle.units.filter(unit=>unit.side===side&&deployed(unit));
const fireballs=count=>Array.from({length:count},(_,index)=>({id:'fire-'+index,kind:'fireball'}));

function charge(battle,attacker,target,readyAt=1){
  Object.assign(battle.runtime.actors[attacker],{phase:'windup',readyAt,targetId:target});
}

test('twenty recruits randomly deploy sixteen, with four queued and the same reload order',()=>{
  const run=newRun(87);
  for(let i=0;i<20;i++)recruit(run,'guard');
  const saved=JSON.parse(JSON.stringify(run));
  assert.ok(startBattle(run));
  assert.ok(startBattle(saved));
  assert.deepEqual(saved.battle,run.battle);
  assert.equal(live(run.battle,0).length,FIELD_LIMIT);
  assert.equal(run.battle.reserves[0].length,4);
  const reserve=new Set(run.battle.reserves[0]);
  assert.ok(run.battle.units.filter(unit=>unit.side===0&&!unit.field).every(unit=>reserve.has(unit.id)));
  assert.notDeepEqual([...reserve],run.roster.slice(16).map(unit=>unit.id));
});

test('the first two opening deaths release one of four reserves before regular combat starts',()=>{
  const {battle}=scenario([['guard']],Array.from({length:20},()=>['orc']));
  const expected=battle.reserves[1][0];
  battle.openingSpells=fireballs(2);
  const result=simulateBattleWindow(battle,{tickLimit:0});
  assert.equal(live(result.next,1).length,15);
  assert.equal(result.next.reserves[1].length,3);
  assert.equal(result.next.recruitedDeaths[1],0);
  assert.deepEqual(result.events.find(event=>event.phase==='补员').focus,[expected]);
  assert.equal(playbackFrames(result)[0].duration,EFFECT_MS);
});

test('a summoned skeleton always enters immediately even when the side goes above sixteen',()=>{
  const {battle}=scenario([['guard']],Array.from({length:18},()=>['armoredSkeleton']));
  battle.openingSpells=fireballs(1);
  const result=simulateBattleWindow(battle,{tickLimit:0});
  assert.equal(live(result.next,1).length,18);
  assert.equal(live(result.next,1).filter(unit=>unit.temporary).length,3);
  assert.equal(result.next.reserves[1].length,2);
  assert.equal(result.next.recruitedDeaths[1],1);
  assert.ok(result.events.some(event=>event.phase==='召唤'));
});

test('a temporary skeleton dying does not pay for a reserve or enter the permanent roster',()=>{
  const run=scenario(Array.from({length:18},()=>['armoredSkeleton']),[['orc']]);
  const {battle}=run;
  const enemy=live(battle,1)[0];
  enemy.bonus=99;
  const effects=createEffects(battle,new Map(battle.units.map(unit=>[unit.id,unit])),()=>{});
  effects.attack(enemy,live(battle,0)[0]);
  const skeleton=live(battle,0).find(unit=>unit.temporary);
  effects.attack(enemy,skeleton);
  const result=simulateBattleWindow(battle,{tickLimit:1});
  assert.equal(result.next.recruitedDeaths[0],1);
  assert.equal(result.next.reserves[0].length,2);
  assert.equal(result.events.filter(event=>event.phase==='补员').length,0);
  commitBattleWindow(run,result);
  assert.equal(run.roster.length,18);
});

test('opening lethal damage revives a templar and only final deaths count toward reinforcement',()=>{
  const {battle}=scenario([['guard']],Array.from({length:18},()=>['templar']));
  battle.openingSpells=fireballs(1);
  const {next,events}=simulateBattleWindow(battle,{tickLimit:0});
  const revived=live(next,1).find(unit=>unit.revived);
  assert.equal(revived.hp,maxHealth(revived));
  assert.equal(live(next,1).length,16);
  assert.equal(next.recruitedDeaths[1],0);
  assert.equal(next.reserves[1].length,2);
  assert.ok(events.some(event=>event.phase==='复活'));
});

test('an armored skeleton on the last tile summons before the loss check',()=>{
  const {battle}=scenario([['guard']],[['armoredSkeleton']]);
  battle.openingSpells=fireballs(1);
  const result=simulateBattleWindow(battle,{tickLimit:0});
  assert.equal(result.outcome,undefined);
  assert.equal(live(result.next,1).length,3);
});

test('opened spells can end a fight before the first combat tick and replay their effect',()=>{
  const run=scenario([['guard']],[['orc']]);
  run.battle.openingSpells=fireballs(1);
  const window=simulateBattleWindow(run.battle);
  assert.equal(window.outcome,'胜利');
  assert.equal(window.next.runtime.tick,0);
  const [frame]=playbackFrames(window);
  assert.equal(window.ticks.length,1);
  assert.equal(frame.duration,EFFECT_MS);
  const defeated=actorFeedback(frame.moments).get('1-0');
  assert.equal(defeated.death,true);
  assert.equal(defeated.hit,true);
  assert.ok(commitBattleWindow(run,window));
  assert.equal(commitBattleWindow(run,window),false);
  assert.deepEqual(run.results,['胜利']);
  assert.deepEqual(window,simulateBattleWindow(run.history[0],{tickLimit:0}));
});

test('battle windows produce the same state with effects or fast-forwarded frames',()=>{
  const {battle}=scenario([['guard'],['archer'],['orc']],[['orc'],['guard']]);
  const ordinary=simulateBattleWindow(battle);
  const fast=simulateBattleWindow(JSON.parse(JSON.stringify(battle)),{captureEvents:false});
  assert.deepEqual(fast.next,ordinary.next);
  assert.equal(fast.outcome,ordinary.outcome);
  assert.equal(fast.ticks.length,0);
  assert.ok(ordinary.ticks.length);
});

test('both sides move from the same snapshot without passing through each other',()=>{
  const p=[{x:300,y:300},{x:420,y:300}];
  const v=[{x:100,y:0},{x:-100,y:0}];
  const [left,right]=resolveMovement(p,v);
  assert.equal(left.x+right.x,720);
  assert.equal(right.x-left.x,COMBAT.separation);
  assert.deepEqual(resolveMovement(p.toReversed(),v.toReversed()).toReversed(),[left,right]);
  assert.deepEqual(p,[{x:300,y:300},{x:420,y:300}]);
});

test('a lethal hit interrupts a queued strike, and the dead fighter is ignored by later hits',()=>{
  const {battle}=scenario([['orc',430,310],['archer',400,220]],[['guard',520,310]]);
  battle.units[2].hp=2;
  charge(battle,'0-0','1-0',2);
  charge(battle,'0-1','1-0',2);
  charge(battle,'1-0','0-0',2);
  const {next,events,outcome}=simulateBattleWindow(battle);
  assert.equal(outcome,'胜利');
  assert.equal(next.units[2].hp,0);
  assert.deepEqual(events.filter(event=>event.action==='attack').map(event=>event.source),['0-0']);
});

test('ranged fighters leave enough space for other fighters to pass',()=>{
  const {battle}=scenario([['bone',340,320],['orc',273,320]],[['guard',570,322]]);
  battle.units[2].hp=160;
  for(const tick of simulateBattleWindow(battle).ticks){
    const positions=Object.values(tick.state.runtime.actors).map(actor=>actor.position);
    for(let i=0;i<positions.length;i++)for(const other of positions.slice(i+1)){
      assert.ok(distance(positions[i],other)>=COMBAT.separation-1e-6);
    }
  }
  assert.ok(distance(battle.runtime.actors['0-1'].position,battle.runtime.actors['1-0'].position)>profile('orc').range);
});

test('rider extra attacks find a live enemy and use the earlier permanent kill growth',()=>{
  const run=scenario([['orcRider',450,310]],[['page',550,310],['orc',468,410]]);
  charge(run.battle,'0-0','1-0');
  const window=simulateBattleWindow(run.battle,{tickLimit:1});
  assert.deepEqual(window.events.filter(event=>event.action==='attack').map(event=>
    [event.target,event.damage,event.followUp]),[['1-0',3,undefined],['1-1',4,true]]);
  assert.equal(window.next.units.find(unit=>unit.id==='1-1').hp,6);
  assert.equal(frameMessage(playbackFrames(window)[0]).phase,'连击');
  assert.ok(commitBattleWindow(run,window));
  while(run.phase==='battle')commitBattleWindow(run,simulateBattleWindow(run.battle,{captureEvents:false}));
  assert.ok(run.roster[0].gainedAttack>=1);
  assert.equal(run.roster[0].gainedAttack,run.roster[0].gainedHealth);
});

test('simultaneous strikes and movement share one fixed playback beat',()=>{
  const {battle}=scenario([
    ['archer',385,210],['archer',400,280],['guard',255,529],
  ],[
    ['guard',493,302],['bone',484,160],['orc',780,522],
  ]);
  charge(battle,'0-0','1-0');
  charge(battle,'0-1','1-0');
  charge(battle,'1-1','0-0');
  const result=simulateBattleWindow(battle);
  const frames=playbackFrames(result),frame=frames[0];
  assert.deepEqual(frame.moments.filter(event=>event.action==='attack').map(event=>event.source),['1-1','0-0','0-1']);
  assert.ok(frame.moments.some(event=>event.phase==='移动'));
  assert.equal(frame.duration,COMBAT_TICK_MS);
  assert.deepEqual(frameMessage(frame),{phase:'攻击',text:'3 名单位出手。'});
  assert.equal(actorFeedback(frame.moments).get('1-0').damage,6);
  assert.deepEqual(frames.flatMap(frame=>frame.moments),result.events);
});

test('the prepared physician heals a living target once and cannot heal a slain target',()=>{
  const {battle}=scenario([['medic',430,230],['guard',430,310]],[['orc',520,310]]);
  battle.medicTargets['0-0']='0-1';
  battle.units[1].hp=8;
  charge(battle,'1-0','0-1');
  const next=simulateBattleWindow(battle,{tickLimit:1});
  assert.equal(next.next.units[1].hp,maxHealth(next.next.units[1]));
  assert.ok(next.events.some(event=>event.action==='heal'&&event.target==='0-1'));
  assert.equal(next.next.medicTargets['0-0'],undefined);
  battle.units[1].hp=1;
  const dead=simulateBattleWindow(battle,{tickLimit:1});
  assert.ok(dead.events.some(event=>event.action==='death'&&event.focus.includes('0-1')));
  assert.ok(!dead.events.some(event=>event.action==='heal'));
});

test('undead archers stack combat attack on each final friendly undead death',()=>{
  const {battle}=scenario([['bone',395,210],['page',430,310],['page',430,385]],[['orc',520,310]]);
  const enemy=battle.units.at(-1);
  const effects=createEffects(battle,new Map(battle.units.map(unit=>[unit.id,unit])),()=>{});
  effects.attack(enemy,battle.units[1]);
  effects.attack(enemy,battle.units[2]);
  assert.equal(currentAttack(battle.units[0]),8);
  assert.equal(battle.units.length,4);
});

test('the adventure can progress seven times with one grant per shop and three even-win removal marks',()=>{
  const run=newRun(5);
  for(let index=0;index<6;index++)recruit(run,'archer',50,200);
  for(let stage=0;stage<7;stage++){
    assert.equal(run.stage,stage);
    assert.equal(run.shop.paidSpins,0);
    assert.ok(resolveSpin(run));
    assert.ok(startBattle(run));
    while(run.phase==='battle')commitBattleWindow(run,simulateBattleWindow(run.battle,{captureEvents:false}));
    assert.equal(run.results.at(-1),'胜利');
    const prior=run.gold;
    advance(run);
    if(stage<6){
      assert.equal(run.phase,'shop');
      assert.equal(run.gold-prior,[8,10,12,14,16,18][stage]);
    }
  }
  assert.equal(run.phase,'end');
  assert.equal(removalMarkers(run),3);
});
