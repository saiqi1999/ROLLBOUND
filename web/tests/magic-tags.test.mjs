import test from 'node:test';
import assert from 'node:assert/strict';
import {tagOffer} from '../src/data.ts';
import {newRun,startBattle} from '../src/engine.ts';
import {addTag,tagCount,tagIds,tagRegions} from '../src/magic-tags.ts';
import {wheelFrame} from '../src/shop/model.ts';
import {buy,recruit,resolveSpin,shopOffers} from '../src/shop/rules.ts';
import {applyMagicTag} from '../src/shop/tags.ts';
import {drawPaidShopBoard,unitSlot} from '../src/shop/wheel.ts';

test('the mixed slot chooses its category independently of the size of either pool',()=>{
  const samples=4096, kinds=new Set();
  let spells=0;
  for(let index=0;index<samples;index++){
    const seed=Math.imul(index,2654435761)>>>0;
    const [a,b,c,mixed]=shopOffers(seed,index%7,index%9);
    assert.equal(new Set([a,b,c].map(offer=>offer.kinds[0])).size,3);
    if(mixed.type==='spell')spells++;
    else kinds.add(mixed.tag);
    if(index<10)assert.deepEqual(shopOffers(seed,index%7,index%9)[3],mixed);
  }
  assert.ok(Math.abs(spells/samples-.5)<.025);
  assert.deepEqual([...kinds].sort(),[...tagIds].sort());
});

test('buying a tag pays once, and replacing a tag updates only the live wheel',()=>{
  const run=newRun(19);
  const unit=recruit(run,'guard',3,2);
  const first=resolveSpin(run);
  run.shop.offers=[tagOffer('shield')];
  const gold=run.gold;
  assert.ok(buy(run,0));
  assert.equal(run.gold,gold-5);
  assert.ok(!buy(run,0));
  assert.deepEqual(run.tagInventory,{shield:1});
  assert.equal(applyMagicTag(run,'missing','shield').reason,'unknownTarget');
  assert.ok(applyMagicTag(run,unit.id,'shield').ok);
  assert.equal(first.settledStats[unit.id].tag,undefined);
  assert.equal(wheelFrame(run.shop.board,run.roster).stats[unit.id].tag,'shield');
  addTag(run.tagInventory,'shield');
  assert.equal(applyMagicTag(run,unit.id,'shield').reason,'alreadyApplied');
  addTag(run.tagInventory,'growth');
  assert.equal(applyMagicTag(run,unit.id,'growth').previous,'shield');
  assert.deepEqual(run.tagInventory,{shield:1});
  assert.equal(unit.tag,'growth');
  assert.deepEqual([unit.gainedAttack,unit.gainedHealth],[3,2]);
});

test('maximal region placement fits four corner pieces and a center for every sampled seed',()=>{
  const run=newRun(12);
  for(let index=0;index<5;index++)recruit(run,'guard').tag=index===4?'center':'topLeft';
  for(let seed=0;seed<100;seed++){
    const {board,positioned}=drawPaidShopBoard(run.roster,[],{rng:seed});
    assert.equal(positioned,5);
    for(const unit of run.roster)assert.ok(tagRegions[unit.tag].includes(board.findIndex(slot=>slot?.id===unit.id)));
  }
});

test('excess region pieces return to the ordinary pool and fully positioned boards leave spells pending',()=>{
  const run=newRun(18);
  for(let index=0;index<5;index++)recruit(run,'guard').tag='topLeft';
  const spell={id:'spell-0',kind:'fireball'};
  run.spells.push(spell);
  const {board,positioned}=drawPaidShopBoard(run.roster,run.spells,{rng:12});
  assert.equal(positioned,4);
  assert.equal(new Set(board.filter(Boolean).map(slot=>slot.id)).size,6);
  for(const tag of ['topRight','bottomLeft','bottomRight']){
    for(let index=0;index<4;index++)recruit(run,'guard').tag=tag;
  }
  const spin=resolveSpin(run);
  assert.equal(spin.positioned,16);
  assert.equal(spin.fallbackDraws,0);
  assert.deepEqual(run.spells,[spell]);
});

test('a tagged greatsword replacement waits and competes for its region on the next paid spin',()=>{
  const run=newRun(94);
  const mage=recruit(run,'king'),skeleton=recruit(run,'greatswordSkeleton',4,2);
  mage.tag=skeleton.tag='center';
  const first=resolveSpin(run);
  assert.equal(first.drawnStats[skeleton.id].tag,'center');
  const [copy]=run.pendingRecruits;
  assert.equal(copy.tag,'center');
  assert.notEqual(copy.id,skeleton.id);
  assert.ok(!first.settled.some(slot=>slot?.id===copy.id));
  const second=resolveSpin(run);
  assert.ok(tagRegions.center.includes(second.drawn.findIndex(slot=>slot?.id===copy.id)));
  assert.deepEqual(second.drawnStats[copy.id],{attack:15,health:18,tag:'center'});
});

test('all growth tags resolve once at departure, preserving a tag through evolution',()=>{
  const run=newRun(17);
  const orc=recruit(run,'orc');
  orc.tag='growth';
  run.shop.board[5]=unitSlot(orc);
  assert.ok(startBattle(run));
  assert.equal(orc.kind,'armoredOrc');
  assert.equal(orc.tag,'growth');
  assert.deepEqual([orc.gainedAttack,orc.gainedHealth],[5,5]);
  assert.equal(run.battle.units.find(unit=>unit.id===orc.id).tag,'growth');
  assert.ok(!startBattle(run));
  assert.deepEqual([orc.gainedAttack,orc.gainedHealth],[5,5]);
});
