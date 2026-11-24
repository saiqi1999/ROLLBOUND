import test from 'node:test';
import assert from 'node:assert/strict';
import {advance,commitBattleWindow,newRun,simulateBattleWindow,startBattle} from '../src/engine.ts';
import {tagCount} from '../src/magic-tags.ts';
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
    openingSpells:run.shop.openingSpells,
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
  const effects=createEffects(battle,()=>{});
  effects.attack(enemy,[live(battle,0)[0]]);
  const skeleton=live(battle,0).find(unit=>unit.temporary);
  effects.attack(enemy,[skeleton]);
  const result=simulateBattleWindow(battle,{tickLimit:1});
  assert.equal(result.next.recruitedDeaths[0],1);
  assert.equal(result.next.reserves[0].length,2);
  assert.equal(result.events.filter(event=>event.phase==='补员').length,0);
  commitBattleWindow(run,result);
  assert.equal(run.roster.length,18);
});

test('opening lethal damage removes the templar and grants other deployed humans four attack and health',()=>{
  const {battle}=scenario([['guard']],Array.from({length:18},()=>['templar']));
  battle.openingSpells=fireballs(1);
  const {next,events}=simulateBattleWindow(battle,{tickLimit:0});
  const survivors=live(next,1);
  assert.equal(survivors.length,15);
  assert.ok(survivors.every(unit=>currentAttack(unit)===6&&unit.hp===13&&maxHealth(unit)===13));
  assert.equal(next.recruitedDeaths[1],1);
  assert.equal(next.reserves[1].length,2);
  const fallen=next.units.find(unit=>unit.hp===0);
  assert.equal(fallen.field,false);
  assert.ok(events.some(event=>event.phase==='阵亡'&&event.action==='empower'));
});

test('an armored skeleton on the last tile summons before the loss check',()=>{
  const {battle}=scenario([['guard']],[['armoredSkeleton']]);
  battle.openingSpells=fireballs(1);
  const result=simulateBattleWindow(battle,{tickLimit:0});
  assert.equal(result.outcome,undefined);
  assert.equal(live(result.next,1).length,3);
});

test('a greatsword skeleton destroyed in combat leaves no copy',()=>{
  const {battle}=scenario([['guard']],[['greatswordSkeleton']]);
  battle.openingSpells=fireballs(1);
  const {next,outcome}=simulateBattleWindow(battle,{tickLimit:0});
  assert.equal(outcome,'胜利');
  assert.equal(next.units.filter(unit=>unit.kind==='greatswordSkeleton').length,1);
  assert.equal(live(next,1).length,0);
});

test('a werebear gains armour equal to its current attack even on a fully blocked hit',()=>{
  const {battle}=scenario([['werebear']],[['guard']]);
  const [bear,target]=battle.units;
  bear.bonus=4;
  target.shield=10;
  const events=[];
  createEffects(battle,(phase,text,focus,detail)=>events.push({phase,text,focus,...detail})).attack(bear,[target]);
  assert.equal(bear.shield,7);
  assert.equal(target.hp,12);
  assert.equal(target.shield,3);
  assert.equal(actorFeedback(events).get(bear.id).shield,7);
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

test('a werewolf can get its first attack while pursuing an archer behind the frontline',()=>{
  const run=newRun(247);
  recruit(run,'armoredSkeleton');
  recruit(run,'greatswordSkeleton');
  const wolf=recruit(run,'werewolf');
  assert.ok(startBattle(run));
  const result=simulateBattleWindow(run.battle,{captureFrames:false,tickLimit:100});
  const attacks=result.events.filter(event=>event.action==='attack'&&event.source===wolf.id);
  assert.ok(attacks.length);
});

test('a blocked wolf steps sideways around a unit and strikes its original target after reload',()=>{
  const {battle}=scenario([['werewolf',200,300]],[['orc',262,300],['bone',460,300]]);
  for(const unit of live(battle,1))Object.assign(battle.runtime.actors[unit.id],{phase:'recover',readyAt:30});
  const [wolf,blocker,archer]=battle.units.map(unit=>unit.id);
  const actors=battle.runtime.actors;
  actors[wolf].targetId=archer;
  const first=simulateBattleWindow(battle,{tickLimit:1}).next;
  const position=first.runtime.actors[wolf].position;
  assert.ok(distance(position,actors[archer].position)>distance(actors[wolf].position,actors[archer].position));
  assert.ok(first.runtime.actors[wolf].detour.waypoints.length);
  const continued=simulateBattleWindow(JSON.parse(JSON.stringify(first)),{tickLimit:12});
  const attack=continued.events.find(event=>event.action==='attack'&&event.source===wolf);
  assert.equal(attack?.target,archer);
  for(const {state} of continued.ticks){
    const actors=state.runtime.actors;
    assert.equal(actors[wolf].targetId,archer);
    assert.ok(distance(actors[wolf].position,actors[blocker].position)>=COMBAT.separation-1e-6);
  }
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
    [event.target,event.damage,event.followUp]),[['1-0',9,undefined],['1-1',10,true]]);
  assert.equal(window.next.units.find(unit=>unit.id==='1-1').hp,0);
  assert.equal(frameMessage(playbackFrames(window)[0]).phase,'连击');
  assert.ok(commitBattleWindow(run,window));
  while(run.phase==='battle')commitBattleWindow(run,simulateBattleWindow(run.battle,{captureEvents:false}));
  assert.ok(run.roster[0].gainedAttack>=1);
  assert.equal(run.roster[0].gainedAttack,run.roster[0].gainedHealth);
});

test('one triple strike prioritizes reachable guardians and uses a shared damage snapshot before the rider follow-up',()=>{
  const {battle}=scenario([['orcRider',450,310]],[
    ['page',550,310],['templar',450,210],['guard',620,410],['page',355,310],['axeman',800,310],
  ]);
  const rider=battle.units[0];
  rider.tag='triple';
  battle.units[2].hp=3;
  charge(battle,rider.id,'1-0');
  const window=simulateBattleWindow(battle,{tickLimit:1});
  const attacks=window.events.filter(event=>event.action==='attack');
  const [primary,extra,...rest]=attacks;
  assert.deepEqual([primary.target,extra.target,rest[0].target],['1-0','1-1','1-3']);
  assert.ok(attacks.slice(0,3).every(hit=>hit.attackId===primary.attackId&&hit.damage===9));
  assert.equal(window.next.units[0].bonus,3);
  assert.equal(actorFeedback(window.events).get(rider.id).attack,true);
  assert.equal(attacks.filter(hit=>hit.followUp).length,0);
});

test('triple rider hits use one snapshot, followed by an independent single strike with kill growth',()=>{
  const {battle}=scenario([['orcRider',450,310]],[
    ['page',550,310],['guard',450,210],['orc',450,410],
  ]);
  battle.units[0].tag='triple';
  charge(battle,'0-0','1-0');
  const window=simulateBattleWindow(battle,{tickLimit:1});
  const attacks=window.events.filter(event=>event.action==='attack');
  assert.equal(new Set(attacks.slice(0,3).map(event=>event.target)).size,3);
  assert.equal(new Set(attacks.slice(0,3).map(event=>event.attackId)).size,1);
  assert.deepEqual(attacks.map(event=>event.damage),[9,9,9,10]);
  assert.equal(attacks.at(-1).followUp,true);
  assert.notEqual(attacks.at(-1).target,'1-0');
  assert.notEqual(attacks.at(-1).attackId,attacks[0].attackId);
});

test('shield and lifesteal use full damage after armor and overkill, with healing capped at max health',()=>{
  for(const [tag,hp,shield,healing] of [['shield',5,40,0],['lifesteal',5,0,40],['lifesteal',92,0,8]]){
    const {battle}=scenario([['werewolf',450,310]],[['werebear',550,310]]);
    const [attacker,target]=battle.units;
    Object.assign(attacker,{tag,hp,healthBonus:92,bonus:37});
    Object.assign(target,{hp:14,shield:10});
    charge(battle,attacker.id,target.id);
    const window=simulateBattleWindow(battle,{tickLimit:1});
    const hit=window.events.find(event=>event.action==='attack');
    assert.deepEqual([hit.damage,hit.shieldLost,hit.healthLost,hit.shieldGain,hit.healing],[40,10,14,shield,healing]);
    assert.deepEqual([window.next.units[0].hp,window.next.units[0].shield],[hp+healing,shield]);
    assert.equal(actorFeedback(window.events).get(attacker.id).healing,healing);
  }
});

test('clones deploy after the originals, retain their birth stats and do not contribute to reserve deaths',()=>{
  const run=newRun(87);
  for(let index=0;index<17;index++)recruit(run,'werewolf',3,4);
  const plan={
    id:'clones',seed:87,allies:run.roster,enemies:[{kind:'orc',attack:50,health:50}],openingSpells:[],
  };
  const initial=createBattle(plan);
  const reserve=initial.reserves[0][0],first=initial.units.filter(unit=>unit.side===0&&unit.field).slice(0,2);
  const taggedIds=[...first.map(unit=>unit.id),reserve];
  for(const unit of run.roster.filter(unit=>taggedIds.includes(unit.id))){
    unit.tag='clone';
    unit.startingArmor=2;
  }
  const battle=createBattle(plan);
  const clones=battle.units.filter(unit=>unit.cloneOf);
  assert.equal(live(battle,0).length,FIELD_LIMIT+2);
  assert.equal(clones.length,2);
  assert.ok(clones.every(clone=>clone.temporary&&!clone.tag&&clone.shield===2&&currentAttack(clone)===6&&clone.hp===12));
  assert.ok(!clones.some(clone=>clone.cloneOf===reserve));

  const guard=battle.units.find(unit=>unit.side===1);
  const effects=createEffects(battle,()=>{});
  effects.attack(guard,[clones[0]]);
  assert.equal(battle.recruitedDeaths[0],0);
  effects.attack(guard,first.map(unit=>battle.units.find(part=>part.id===unit.id)));
  const result=simulateBattleWindow(battle,{tickLimit:1});
  assert.equal(result.next.reserves[0].length,0);
  assert.equal(result.next.units.filter(unit=>unit.cloneOf===reserve).length,1);
  assert.ok(result.events.some(event=>event.phase==='召唤'&&event.source===reserve));
  const replay=simulateBattleWindow(battle,{tickLimit:1,captureEvents:false});
  assert.deepEqual(replay.next,result.next);
});

test('a team-tagged death applies max-health growth before the unit summons its temporary allies',()=>{
  const {battle}=scenario([['armoredSkeleton'],['werewolf']],[['orc']]);
  const [tagged,ally,enemy]=battle.units;
  Object.assign(tagged,{tag:'team',hp:1,healthBonus:30,battleHealthBonus:5,shield:1});
  ally.hp=4;
  const events=[];
  const effects=createEffects(battle,(phase,text,focus,detail)=>events.push({phase,text,focus,...detail}));
  effects.attack(enemy,[tagged]);
  assert.equal(currentAttack(ally),7);
  assert.equal(maxHealth(ally),12);
  assert.equal(ally.hp,8);
  assert.equal(ally.bonus,0);
  assert.deepEqual(battle.units.filter(unit=>unit.temporary).map(currentAttack),[1,1,1]);
  assert.ok(events.findIndex(event=>event.value==='+4/+4')<events.findIndex(event=>event.phase==='召唤'));
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

test('each living undead archer buffs all surviving friendly undead after each death',()=>{
  const {battle}=scenario([['bone'],['bone'],['page'],['page'],['king'],['guard'],['greatswordSkeleton']],[['orc']]);
  const [archer,other,first,second,king,human,reserve,enemy]=battle.units;
  reserve.field=false;
  delete battle.runtime.actors[reserve.id];
  battle.reserves[0].push(reserve.id);
  const effects=createEffects(battle,()=>{});
  effects.attack(enemy,[first]);
  effects.attack(enemy,[second]);
  assert.deepEqual([archer,other,king,reserve,human,enemy].map(currentAttack),[14,14,15,15,2,3]);
  assert.deepEqual([first,second].map(currentAttack),[1,7]);
});

test('the adventure can progress seven times with one grant per shop and three even-win removal marks',()=>{
  const run=newRun(5);
  for(let index=0;index<12;index++)recruit(run,'archer',100,200);
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
  assert.equal(tagCount(run.tagInventory,'remove'),3);
});
