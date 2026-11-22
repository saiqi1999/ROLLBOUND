import test from 'node:test';
import assert from 'node:assert/strict';
import {encounters,spellOffer,unitEffectText,unitOffer} from '../src/data.ts';
import {advance,canStartBattle,newRun,startBattle} from '../src/engine.ts';
import {addTag,tagCount} from '../src/magic-tags.ts';
import {unitStats} from '../src/shop/model.ts';
import {loadRun,saveRun} from '../src/save.ts';
import {buy,recruit,refreshShop,resolveSpin,shopOffers,spinCost} from '../src/shop/rules.ts';
import {applyMagicTag} from '../src/shop/tags.ts';
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

test('every shop has three distinct unit cards, one spell or tag, and the round income',()=>{
  assert.deepEqual(encounters.map(stage=>stage.gold),[20,8,10,12,14,16,18]);
  const run=newRun(78);
  assert.equal(run.gold,20);
  for(let stage=0;stage<encounters.length;stage++){
    const offers=shopOffers(run.seed,stage);
    assert.equal(new Set(offers.slice(0,3).map(offer=>offer.kinds[0])).size,3);
    assert.ok(offers.slice(0,3).every(offer=>offer.type==='unit'));
    assert.ok(['spell','tag'].includes(offers[3].type));
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
    assert.equal(candidate.shop.board.filter(Boolean).length,4);
    assert.ok(candidate.roster.every(unit=>unit.gainedAttack===0&&unit.gainedHealth===0));
    assert.equal(candidate.shop.paidSpins,0);
  }
  assert.deepEqual(restored,run);
});

test('each successful unit purchase grows wolves already in the roster once',()=>{
  const run=newRun(144);
  run.shop.offers=[unitOffer('werewolf'),unitOffer('werewolf'),unitOffer('king'),spellOffer('recruit')];
  assert.ok(buy(run,0));
  const [first]=run.roster;
  assert.deepEqual(unitStats(first),{attack:3,health:8});
  assert.ok(buy(run,1));
  const second=run.roster[1];
  assert.deepEqual(unitStats(first),{attack:4,health:9});
  assert.deepEqual(unitStats(second),{attack:3,health:8});
  assert.ok(buy(run,2));
  assert.ok(buy(run,3));
  assert.equal(buy(run,2),false);
  assert.deepEqual(unitStats(first),{attack:5,health:10});
  assert.deepEqual(unitStats(second),{attack:4,health:9});
  assert.deepEqual(run.roster.slice(2).map(unit=>[unit.kind,unit.gainedAttack,unit.gainedHealth]),
    [['king',0,0],['page',0,0],['page',0,0]]);
});

test('entering a new shop shows the existing team and a full wheel keeps all its slots on purchase',()=>{
  const run=newRun(4);
  for(let i=0;i<16;i++)recruit(run,i===0?'king':'page');
  run.phase='result';
  advance(run);
  assert.equal(run.shop.board.filter(Boolean).length,16);
  assert.ok(run.roster.every(unit=>run.shop.board.some(slot=>slot?.id===unit.id)));
  assert.equal(run.shop.lastSpin,null);
  const previous=structuredClone(run.shop.board);
  run.shop.offers=[unitOffer('king')];
  assert.ok(buy(run,0));
  assert.deepEqual(run.shop.board,previous);
  assert.equal(run.roster.length,19);
  assert.equal(run.shop.paidSpins,0);
  assert.equal(run.shop.lastSpin,null);
  assert.ok(startBattle(run));
  assert.equal(run.battle.reserves[0].length,3);
});

test('a multi-unit purchase fills only the remaining vacancies without changing occupied slots',()=>{
  const run=newRun(4);
  for(let i=0;i<15;i++)recruit(run,'guard');
  run.phase='result';
  advance(run);
  const previous=run.shop.board.slice();
  run.shop.offers=[unitOffer('king')];
  assert.ok(buy(run,0));
  assert.equal(run.roster.length,18);
  assert.equal(run.shop.board.filter(Boolean).length,16);
  assert.ok(previous.every((slot,index)=>!slot||slot.id===run.shop.board[index].id));
  assert.equal(run.shop.board.filter(slot=>slot?.kind==='king').length,1);
  assert.equal(run.shop.board.filter(slot=>slot?.kind==='page').length,0);
});

test('a shop save restores the current preview and the prior stop without rolling or spending',t=>{
  const run=newRun(18);
  run.shop.offers=[unitOffer('guard'),unitOffer('archer'),unitOffer('lancer')];
  assert.ok(buy(run,0));
  assert.ok(buy(run,1));
  const spin=resolveSpin(run);
  assert.ok(buy(run,2));
  const store=mockStorage(t);
  assert.ok(saveRun(run));
  assert.ok(store.has('rollbound.shop-wheel.v6'));
  const saved=loadRun();
  assert.equal(saved.shop.paidSpins,1);
  assert.equal(saved.gold,run.gold);
  assert.deepEqual(saved.roster,run.roster);
  assert.ok(saved.roster.every(unit=>saved.shop.board.some(slot=>slot?.id===unit.id)));
  assert.ok(spin.settled.every((slot,index)=>!slot||slot.id===saved.shop.board[index].id));
  assert.deepEqual(saved.shop.board,run.shop.board);
});

test('archer grows once per roll beside any guardian, with no additional growth for multiple guardians',()=>{
  const {run,roster,roll}=sampleSpin(['archer','templar','armoredSkeleton'],[],(near,[archer,left,right])=>
    near(archer,left)&&near(archer,right));
  const [archer,left,right]=roster;
  assert.equal(archer.gainedAttack,1);
  assert.deepEqual(new Set(roll.events[0].focus),new Set([archer.id,left.id,right.id]));
  run.gold=100;
  for(let turn=0;turn<10;turn++)resolveSpin(run);
  assert.ok(archer.gainedAttack>1);
  const withoutGuardian=sampleSpin(['archer','guard'],[],(near,[bow,guard])=>near(bow,guard));
  assert.equal(withoutGuardian.roster[0].gainedAttack,0);
});

test('wheel buffs add permanently across rolls and battles, while a single roll deduplicates the same adjacency ability',()=>{
  const {run,roster}=sampleSpin(['wizard','swordsman','swordsman','soldier','guard','axeman'],[],(near,team)=>
    [0,1,2,5].every(index=>near(team[index],team[4])));
  const guard=roster[4];
  assert.deepEqual(unitStats(guard),{attack:4,health:15});
  assert.equal(guard.startingArmor,3);
  assert.ok(startBattle(run));
  const fighter=run.battle.units.find(unit=>unit.id===guard.id);
  assert.equal(fighter.hp,15);
  assert.equal(fighter.shield,3);
  assert.equal(fighter.bonus,2);
  run.phase='result';
  advance(run);
  assert.deepEqual(unitStats(guard),{attack:4,health:15});
  assert.ok(startBattle(run));
  assert.equal(run.battle.units.find(unit=>unit.id===guard.id).shield,3);
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

test('greatsword copies keep permanent stats and wait across saves and battles for the next paid spin',t=>{
  const team=['king','greatswordSkeleton',...Array(14).fill('guard')];
  const {run,roster:[king,original],roll}=sampleSpin(team,[],(near,[king,skeleton])=>near(king,skeleton),
    ([,skeleton])=>Object.assign(skeleton,{gainedAttack:4,gainedHealth:7,startingArmor:3}));
  assert.equal(roll.events.length,1);
  assert.match(roll.events[0].text,/下次摇盘入队/);
  assert.equal(run.roster.length,15);
  const [copy]=run.pendingRecruits;
  assert.deepEqual(run.pendingRecruits,[{
    id:'0-16',kind:'greatswordSkeleton',gainedAttack:9,gainedHealth:12,startingArmor:3,
  }]);
  assert.ok(roll.settled.every(slot=>slot?.id!==original.id&&slot?.id!==copy.id));
  assert.deepEqual([king.gainedAttack,king.gainedHealth],[2,2]);

  mockStorage(t);
  assert.ok(saveRun(run));
  const loaded=loadRun();
  assert.deepEqual(loaded,run);
  loaded.gold=0;
  assert.equal(resolveSpin(loaded),undefined);
  assert.deepEqual(loaded.pendingRecruits,[copy]);
  assert.ok(startBattle(loaded));
  assert.ok(loaded.battle.units.every(unit=>unit.id!==copy.id));
  loaded.phase='result';
  advance(loaded);
  assert.deepEqual(loaded.pendingRecruits,[copy]);
  const second=resolveSpin(loaded);
  assert.ok(second.drawn.some(slot=>slot?.id===copy.id));
  assert.deepEqual(second.drawnStats[copy.id],{attack:12,health:20});
  const copySurvived=loaded.roster.some(unit=>unit.id===copy.id);
  assert.equal(loaded.pendingRecruits.length,copySurvived?0:1);
  if(!copySurvived){
    assert.equal(loaded.pendingRecruits[0].gainedAttack,14);
    assert.equal(loaded.pendingRecruits[0].gainedHealth,17);
    assert.ok(second.settled.every(slot=>slot?.kind!=='greatswordSkeleton'));
  }
});

test('a necromancer can destroy all eight adjacent skeletons in one spin and queue each copy',()=>{
  const {run,roster:[king],roll}=sampleSpin(
    ['king',...Array(15).fill('greatswordSkeleton')],[],(_, [source], __, result)=>
      neighborSlots(result.drawn.findIndex(slot=>slot?.id===source.id)).length===8,
  );
  assert.deepEqual([king.gainedAttack,king.gainedHealth],[16,16]);
  assert.equal(run.pendingRecruits.length,8);
  assert.equal(roll.settled.filter(Boolean).length,8);
  assert.equal(roll.events.length,1);
});

test('a priest and the removal marker cannot create a greatsword skeleton copy',()=>{
  const {run,roster:[priest,skeleton],roll}=sampleSpin(['medic','greatswordSkeleton'],[],
    (near,[priest,skeleton])=>near(priest,skeleton));
  assert.deepEqual(roll.events,[]);
  assert.deepEqual(run.roster,[priest,skeleton]);
  run.results=['胜利','胜利'];
  addTag(run.tagInventory,'remove');
  assert.ok(applyMagicTag(run,skeleton.id,'remove').ok);
  assert.deepEqual(run.roster,[priest]);
});

test('a priest triggers adjacent templar death effects without killing it, and a skeleton pays only on actual destruction',()=>{
  const {run,roster,roll}=sampleSpin(['medic','templar','page','guard'],[],(near,[priest,templar,page])=>
    near(priest,templar)&&near(priest,page));
  const [priest,templar,page,guard]=roster;
  assert.deepEqual(run.roster,roster);
  assert.equal(run.gold,19);
  assert.deepEqual(unitStats(priest),{attack:5,health:12});
  assert.deepEqual(unitStats(guard),{attack:6,health:16});
  assert.equal(templar.gainedAttack,0);
  assert.equal(page.gainedAttack,0);
  assert.match(roll.events[0].text,/牧师.*圣殿骑士/);
});

test('a priest summons from an armored skeleton once even when those recruits requeue the priest',()=>{
  const {run,roster,roll}=sampleSpin(['medic','armoredSkeleton'],[],(near,[priest,armor])=>near(priest,armor));
  const [priest,armor]=roster;
  assert.equal(run.roster.filter(unit=>unit.kind==='page').length,3);
  assert.ok(run.roster.includes(armor));
  assert.ok(roll.settled.some(slot=>slot?.id===priest.id));
  assert.ok(roll.settled.some(slot=>slot?.id===armor.id));
  assert.equal(roll.events.filter(event=>event.text.includes('触发死亡效果')).length,1);
});

test('armored skeleton destruction fills randomized empty slots and can chain multiple destructions',()=>{
  const {run,roster,roll}=sampleSpin(['king','armoredSkeleton'],[],(near,[king,armored])=>near(king,armored));
  const [king,armored]=roster;
  const [death,chain]=roll.events;
  const positions=death.after.board.flatMap((slot,index)=>slot?.kind==='page'?[index]:[]);
  assert.equal(positions.length,3);
  assert.ok(positions.every(index=>!roll.drawn[index]||roll.drawn[index].id===armored.id));
  assert.equal(new Set(positions.map(index=>death.after.board[index].id)).size,3);
  assert.deepEqual(roll.drawnStats[king.id],{attack:3,health:12});
  assert.deepEqual(death.after.stats[king.id],{attack:5,health:14});
  assert.ok(death.buffed.includes(king.id));
  assert.match(chain.text,/^连锁 · 亡灵法师/);
  const chomped=positions.filter(index=>neighborSlots(roll.drawn.findIndex(slot=>slot?.id===king.id)).includes(index)).length;
  assert.deepEqual(roll.settledStats[king.id],{attack:5+2*chomped,health:14+2*chomped});
  assert.equal(run.roster.filter(unit=>unit.kind==='page').length,3-chomped);
  assert.equal(run.gold,19+2*chomped);
});

test('death recruits that cannot fit stay in the roster without displacing an existing tile',()=>{
  const full=['king','armoredSkeleton',...Array(14).fill('guard')];
  const {run,roster,roll}=sampleSpin(full,[],(near,[king,armored])=>near(king,armored));
  const death=roll.events[0];
  const open=roll.drawn.findIndex(slot=>slot.id===roster[1].id);
  assert.ok(death.after.board.every((slot,index)=>index===open||slot.id===roll.drawn[index].id));
  assert.equal(death.after.board[open].kind,'page');
  assert.equal(run.roster.filter(unit=>unit.kind==='page').length,2);
  assert.equal(roll.settled.filter(slot=>slot?.kind==='page').length,0);
});

test('a space opened by a later unit rechecks vulnerable earlier slots',()=>{
  const team=['lancer','king','page',...Array(13).fill('guard')];
  const {roster,roll}=sampleSpin(team,[],(near,[lancer,king,page],_,result)=>{
    const position=unit=>result.drawn.findIndex(slot=>slot.id===unit.id);
    return position(lancer)<position(king)&&near(lancer,page)&&near(king,page);
  });
  const [lancer]=roster;
  assert.match(roll.events[0].text,/^亡灵法师/);
  assert.match(roll.events[1].text,/^连锁 · 长枪兵/);
  assert.deepEqual(roll.events[1].after.stats[lancer.id],{attack:4,health:7});
});

test('destroying an undead archer adds permanent attack to the destroyer and to a surviving archer',()=>{
  const {run,roster}=sampleSpin(['king','bone','bone'],[],(near,[king,victim,observer])=>
    near(king,victim)&&!near(king,observer));
  const [king,victim,observer]=roster;
  assert.deepEqual(run.roster,[king,observer]);
  assert.equal(king.gainedAttack,5);
  assert.equal(observer.gainedAttack,3);
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
  assert.equal(roster[0].gainedAttack,4);
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

test('an elite orc buffs each evolving ally in order and strengthens its own effect',()=>{
  const {run,roster:[elite],roll}=sampleSpin(['eliteOrc','orc','orc'],[],(near,[elite,first,second])=>
    !near(elite,first)||!near(elite,second),([,first,second])=>{
    first.gainedAttack=3;
    second.gainedAttack=3;
  });
  const evolving=roll.drawn.filter(slot=>slot?.kind==='orc');
  assert.deepEqual(evolving.map(slot=>run.roster.find(unit=>unit.id===slot.id)?.kind),['armoredOrc','armoredOrc']);
  assert.deepEqual(evolving.map(slot=>roll.settledStats[slot.id]),[{attack:7,health:25},{attack:8,health:26}]);
  assert.deepEqual(unitStats(elite),{attack:4,health:16});
  assert.equal(elite.evolutionTriggers,2);
  assert.ok(roll.events.every(event=>event.focus.includes(elite.id)));
  run.phase='result';
  advance(run);
  assert.match(unitEffectText('eliteOrc',elite),/永久获得\+3\/\+3，并强化此效果/);
  assert.match(unitEffectText('eliteOrc'),/永久获得\+1\/\+1/);
});

test('the wizard description shows the current spell-scaled bonus and its cap',()=>{
  assert.match(unitEffectText('wizard'),/获得\+1\/\+1/);
  assert.match(unitEffectText('wizard',{spellCasts:2}),/获得\+3\/\+3。每施放一个法术，强化此效果/);
  assert.match(unitEffectText('wizard',{spellCasts:9}),/获得\+4\/\+4/);
});

test('summoning circle places a boosted human who can trigger links in the same roll',()=>{
  const {run,roll}=sampleSpin(['guard'],['fireball','recruit'],(_,__,___,result)=>
    result.events.some(event=>event.text.startsWith('连锁 · ')));
  assert.equal(run.spells.length,0);
  assert.equal(run.spellCasts,2);
  assert.equal(run.roster.length,2);
  const recruit=run.roster[1];
  assert.deepEqual([recruit.gainedAttack,recruit.gainedHealth],[3,3]);
  assert.ok(roll.drawn.every(slot=>slot?.id!==recruit.id));
  assert.ok(roll.settled.some(slot=>slot?.id===recruit.id));
  const ownCast=roll.events.find(event=>event.text.startsWith('召唤法阵'));
  assert.ok(ownCast.after.board.some(slot=>slot?.id===recruit.id));
  assert.ok(ownCast.buffed.includes(recruit.id));
  assert.equal(run.shop.openingSpells.length,1);
  assert.equal(run.shop.openingSpells[0].kind,'fireball');
});

test('slime removal grants permanent growth and preserves each remaining instance and its starting armour',()=>{
  const run=newRun(19);
  const orc=recruit(run,'orc',1,0);
  const slime=recruit(run,'slime');
  const guard=recruit(run,'guard',4,4);
  guard.startingArmor=3;
  addTag(run.tagInventory,'remove');
  run.shop.board[5]={type:'unit',id:slime.id,kind:'slime'};
  run.shop.board[6]={type:'unit',id:orc.id,kind:'orc'};
  assert.equal(tagCount(run.tagInventory,'remove'),1);
  assert.ok(applyMagicTag(run,slime.id,'remove').ok);
  assert.equal(tagCount(run.tagInventory,'remove'),0);
  assert.equal(applyMagicTag(run,slime.id,'remove').ok,false);
  assert.deepEqual(run.roster,[orc,guard]);
  assert.deepEqual([guard.gainedAttack,guard.gainedHealth],[6,6]);
  assert.equal(orc.kind,'armoredOrc');
  assert.equal(run.shop.board[5],null);
  assert.equal(run.shop.board[6].kind,'armoredOrc');
  assert.equal(guard.startingArmor,3);
});

test('a committed shop result survives reload without consuming its spells or money again',()=>{
  const {run}=sampleSpin(['archer','guard'],['fireball'],(near,[archer,guard])=>near(archer,guard));
  const saved=JSON.parse(JSON.stringify(run));
  assert.deepEqual(saved,run);
  assert.equal(saved.shop.paidSpins,1);
  assert.equal(saved.shop.openingSpells.length,1);
  assert.deepEqual(resolveSpin(saved),resolveSpin(run));
  assert.deepEqual(saved,run);
});

function mockStorage(t){
  const storage=new Map();
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),
  }});
  t.after(()=>{
    if(previous)Object.defineProperty(globalThis,'localStorage',previous);
    else delete globalThis.localStorage;
  });
  return storage;
}

test('an older save opens a new game while v6 restores the inventory and equipped tags',t=>{
  const storage=mockStorage(t);
  const run=newRun(88);
  const guard=recruit(run,'guard',2,3);
  storage.set('rollbound.shop-wheel.v5',JSON.stringify({...run,version:5}));
  assert.equal(loadRun(),undefined);
  addTag(run.tagInventory,'shield');
  addTag(run.tagInventory,'remove');
  assert.ok(applyMagicTag(run,guard.id,'shield').ok);
  assert.ok(saveRun(run));
  assert.deepEqual(loadRun(),run);
});
