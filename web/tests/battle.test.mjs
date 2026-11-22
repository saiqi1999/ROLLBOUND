import test from 'node:test';
import assert from 'node:assert/strict';
import {encounters,spellOffer,unitOffer} from '../src/data.ts';
import {advance,canStartBattle,newRun,removalMarkers,removeUnit,startBattle} from '../src/engine.ts';
import {preparedStats} from '../src/shop/model.ts';
import {buy,recruit,refreshShop,resolveSpin,shopOffers,spinCost} from '../src/shop/rules.ts';
import {drawShopBoard,neighborSlots} from '../src/shop/wheel.ts';

function sampleSpin(kinds,spellKinds,condition,prepare=()=>{}){
  for(let seed=0;seed<1000;seed++){
    const run=newRun(seed);
    const roster=kinds.map(kind=>recruit(run,kind));
    prepare(roster);
    const spells=spellKinds.map(kind=>({kind,id:'spell-'+run.nextId++}));
    run.spells.push(...spells);
    const roll=resolveSpin(run);
    const nearby=(left,right)=>neighborSlots(roll.drawn.findIndex(slot=>slot?.id===left.id))
      .includes(roll.drawn.findIndex(slot=>slot?.id===right.id));
    if(condition(nearby,roster,spells,roll))return {run,roster,spells,roll};
  }
  assert.fail('The seeded samples never produced the required layout');
}

test('every shop has three distinct unit cards, one spell, and the new round income',()=>{
  assert.deepEqual(encounters.map(stage=>stage.gold),[20,8,10,12,14,16,18]);
  const run=newRun(78);
  assert.equal(run.gold,20);
  for(let stage=0;stage<encounters.length;stage++){
    const offers=shopOffers(run.seed,stage);
    assert.equal(new Set(offers.slice(0,3).map(offer=>offer.kinds[0])).size,3);
    assert.ok(offers.slice(0,3).every(offer=>!offer.spell));
    assert.ok(offers[3].spell);
  }
  assert.equal(unitOffer('page').price,1);
  assert.equal(unitOffer('guard').price,2);
  assert.equal(unitOffer('king').price,5);
  assert.equal(spellOffer('recruit').price,2);
  assert.equal(spellOffer('surge').price,3);
  assert.equal(spellOffer('fireball').price,4);
  assert.equal(canStartBattle(run),false);
});

test('a four-by-four draw contains distinct symbols and includes diagonal neighbors',()=>{
  assert.deepEqual(neighborSlots(0),[1,4,5]);
  assert.deepEqual(neighborSlots(5),[0,1,2,4,6,8,9,10]);
  const run=newRun(99);
  for(let i=0;i<24;i++)recruit(run,'guard');
  run.spells.push({kind:'fireball',id:'spell-'+run.nextId++});
  const board=drawShopBoard(run.roster,run.spells,{rng:42});
  assert.equal(board.length,16);
  assert.equal(new Set(board.map(slot=>slot.id)).size,16);
  assert.equal(drawShopBoard(run.roster.slice(0,1),[],{rng:42}).filter(Boolean).length,1);
});

test('paid spins cost 1, 1, 2, 2, 3, 3 with no counter change on refresh or rejection',()=>{
  const run=newRun(8);
  assert.equal(resolveSpin(run),undefined);
  recruit(run,'guard');
  for(const price of [1,1,2,2,3,3]){
    const before=run.gold;
    assert.equal(spinCost(run.shop.paidSpins),price);
    assert.ok(resolveSpin(run));
    assert.equal(run.gold,before-price);
  }
  assert.equal(run.gold,8);
  assert.ok(refreshShop(run));
  assert.equal(run.gold,7);
  assert.equal(run.shop.paidSpins,6);
  run.gold=3;
  assert.equal(resolveSpin(run),undefined);
  assert.equal(run.shop.paidSpins,6);
  run.phase='result';
  advance(run);
  assert.equal(run.gold,11);
  assert.equal(run.shop.paidSpins,0);
  assert.equal(run.shop.lastSpin,null);
});

test('buying a necromancer creates distinct units, and a bat grants a deterministic spell',()=>{
  const run=newRun(144);
  run.shop.offers=[unitOffer('king'),unitOffer('bat')];
  const restored=JSON.parse(JSON.stringify(run));
  for(const candidate of [run,restored]){
    assert.equal(buy(candidate,0),true);
    assert.equal(buy(candidate,0),false);
    assert.equal(buy(candidate,1),true);
    assert.equal(candidate.gold,12);
    assert.deepEqual(candidate.roster.map(unit=>unit.kind),['king','page','page','bat']);
    assert.equal(new Set(candidate.roster.map(unit=>unit.id)).size,4);
    assert.equal(candidate.spells.length,1);
  }
  assert.deepEqual(restored,run);
});

test('archer growth is permanent and applies only once per shop even if several guards are adjacent',()=>{
  const {run,roster,roll}=sampleSpin(['archer','guard','guard'],[],(near,[archer,left,right])=>
    near(archer,left)&&near(archer,right));
  const [archer,left,right]=roster;
  assert.equal(archer.gainedAttack,1);
  assert.deepEqual(new Set(roll.events[0].focus),new Set([archer.id,left.id,right.id]));
  run.gold=100;
  for(let turn=0;turn<12;turn++)resolveSpin(run);
  assert.equal(archer.gainedAttack,1);
  assert.equal(run.shop.archersGrown.length,1);
});

test('preparations are grouped by ability, so same-name buffs take the strongest and different ones add',()=>{
  const {run,roster}=sampleSpin(['wizard','swordsman','swordsman','soldier','guard','axeman'],[],(near,team)=>
    [0,1,2,5].every(index=>near(team[index],team[4])));
  const guard=roster[4];
  assert.deepEqual(preparedStats(run.shop.preparations,guard.id),{attack:3,health:4,shield:3});
  assert.ok(startBattle(run));
  const fighter=run.battle.units.find(unit=>unit.id===guard.id);
  assert.equal(fighter.hp,16);
  assert.equal(fighter.shield,3);
  assert.equal(fighter.battleAttackBonus,3);
});

test('a skeleton destroyed in the shop grants two gold without replacing its instance',()=>{
  const {run,roster,roll}=sampleSpin(['king','page'],[],(near,[king,page])=>near(king,page));
  const [king,page]=roster;
  assert.equal(run.gold,21);
  assert.deepEqual(run.roster,[king]);
  assert.deepEqual([king.gainedAttack,king.gainedHealth],[2,2]);
  assert.ok(roll.drawn.some(slot=>slot?.id===page.id));
  assert.ok(roll.settled.every(slot=>slot?.id!==page.id));
});

test('armored skeleton destruction permanently recruits three fresh skeletons for the next draw',()=>{
  const {run,roster,roll}=sampleSpin(['king','armoredSkeleton'],[],(near,[king,armored])=>near(king,armored));
  assert.deepEqual(run.roster.map(unit=>unit.kind),['king','page','page','page']);
  assert.ok(run.roster.slice(1).every(unit=>roll.drawn.every(slot=>slot?.id!==unit.id)));
  assert.equal(run.roster.some(unit=>unit.id===roster[1].id),false);
  assert.ok(resolveSpin(run).drawn.filter(slot=>slot?.kind==='page').length===3);
});

test('destroying an undead archer buffs the actual destroyer and another living archer on the wheel',()=>{
  const {run,roster}=sampleSpin(['king','bone','bone'],[],(near,[king,victim,observer])=>
    near(king,victim)&&!near(king,observer));
  const [king,victim,observer]=roster;
  assert.deepEqual(run.roster,[king,observer]);
  assert.equal(preparedStats(run.shop.preparations,king.id).attack,3);
  assert.equal(preparedStats(run.shop.preparations,observer.id).attack,3);
  assert.equal(run.shop.preparations.buffs[victim.id],undefined);
});

test('a shared target is destroyed by the first necromancer in display order exactly once',()=>{
  const {run,roster,roll}=sampleSpin(['king','king','page'],[],(near,[left,right,page])=>near(left,page)&&near(right,page));
  const first=roll.drawn.find(slot=>slot?.kind==='king');
  assert.equal(roster.find(unit=>unit.id===first.id).gainedAttack,2);
  assert.equal(roster.filter(unit=>unit.kind==='king'&&unit.gainedAttack===0).length,1);
  assert.equal(run.gold,21);
  assert.equal(roll.events.length,1);
});

test('spells resolve before links, and an Orc with six attack evolves before the next fight',()=>{
  const {run,roster,spells,roll}=sampleSpin(['orc','wizard'],['surge'],(near,[orc,wizard],[surge])=>
    near(surge,orc)&&near(wizard,orc));
  assert.ok(roll.events[0].focus.includes(spells[0].id));
  assert.equal(roster[0].gainedAttack,2);
  assert.equal(roster[0].kind,'armoredOrc');
  assert.equal(run.spellCasts,1);
  assert.equal(run.spells.length,0);
  assert.equal(roll.settled.find(slot=>slot?.id===roster[0].id).kind,'armoredOrc');
});

test('armored orc needs two other neighboring Orcs and retains its permanent stats',()=>{
  const {roster}=sampleSpin(['armoredOrc','orc','orc'],[],(near,[armor,left,right])=>
    near(armor,left)&&near(armor,right),([armor])=>{armor.gainedHealth=9;});
  assert.equal(roster[0].kind,'orcRider');
  assert.equal(roster[0].gainedHealth,9);
});

test('summoning circle permanently recruits one boosted human and only fireball is loaded for battle',()=>{
  const {run,roll}=sampleSpin(['guard'],['fireball','recruit'],()=>true);
  assert.equal(run.spells.length,0);
  assert.equal(run.spellCasts,2);
  assert.equal(run.roster.length,2);
  const recruit=run.roster[1];
  assert.deepEqual([recruit.gainedAttack,recruit.gainedHealth],[3,3]);
  assert.ok(roll.drawn.every(slot=>slot?.id!==recruit.id));
  assert.equal(run.shop.preparations.openingSpells.length,1);
  assert.equal(run.shop.preparations.openingSpells[0].kind,'fireball');
});

test('slime removal grants permanent growth and preserves each remaining instance and its preparation',()=>{
  const run=newRun(19);
  const orc=recruit(run,'orc',1,0);
  const slime=recruit(run,'slime');
  const guard=recruit(run,'guard',4,4);
  run.shop.preparations.medicTargets[slime.id]=guard.id;
  run.shop.preparations.buffs[guard.id]={soldier:{health:1}};
  run.results=['胜利','胜利'];
  assert.equal(removalMarkers(run),1);
  assert.ok(removeUnit(run,slime.id));
  assert.equal(removalMarkers(run),0);
  assert.equal(removeUnit(run,slime.id),false);
  assert.deepEqual(run.roster,[orc,guard]);
  assert.deepEqual([guard.gainedAttack,guard.gainedHealth],[6,6]);
  assert.equal(orc.kind,'armoredOrc');
  assert.equal(preparedStats(run.shop.preparations,guard.id).health,1);
  assert.equal(run.shop.preparations.medicTargets[slime.id],undefined);
});

test('a committed shop result survives reload without consuming its spells or money again',()=>{
  const {run}=sampleSpin(['archer','guard'],['fireball'],(near,[archer,guard])=>near(archer,guard));
  const saved=JSON.parse(JSON.stringify(run));
  assert.deepEqual(saved,run);
  assert.equal(saved.shop.paidSpins,1);
  assert.equal(saved.shop.preparations.openingSpells.length,1);
  assert.deepEqual(resolveSpin(saved),resolveSpin(run));
  assert.deepEqual(saved,run);
});
