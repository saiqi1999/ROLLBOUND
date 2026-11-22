import test from 'node:test';
import assert from 'node:assert/strict';
import {newRun,canStartBattle} from '../src/engine.ts';
import {spellOffer,unitOffer} from '../src/data.ts';
import {simulateDifficulty,spendShopGold} from '../scripts/simulate-difficulty.mjs';

test('the simulation retains enough budget for the planned shop spins',()=>{
  const run=newRun(1);
  run.gold=8;
  run.shop.offers=[unitOffer('king'),unitOffer('soldier'),unitOffer('medic'),spellOffer('fireball')];
  spendShopGold(run);
  assert.equal(run.gold,0);
  assert.equal(run.shop.refreshes,0);
  assert.deepEqual(run.roster.map(unit=>unit.kind),['soldier']);
  assert.equal(run.shop.preparations.openingSpells.length,1);
  assert.equal(run.shop.paidSpins,2);
  assert.ok(canStartBattle(run));
});

test('the simulated shop carries its last coin when a refresh cannot lead to a purchase',()=>{
  const run=newRun(3);
  run.stage=1;
  run.gold=1;
  run.shop.offers=[unitOffer('king'),unitOffer('soldier'),unitOffer('medic'),spellOffer('fireball')];
  spendShopGold(run,{spins:0});
  assert.equal(run.gold,1);
  assert.equal(run.shop.refreshes,0);
});

test('the seven-stage simulation is seeded and sends surviving runs to the next shop',()=>{
  const result=simulateDifficulty(12,100000);
  assert.deepEqual(result,simulateDifficulty(12,100000));
  assert.equal(result.stages[0].reached,12);
  result.stages.forEach((stage,index)=>{
    assert.equal(stage.reached,stage.wins+stage.losses+stage.draws);
    assert.ok(stage.full<=stage.reached);
    assert.ok(stage.reserves<=stage.full);
    if(index>0)assert.equal(stage.reached,result.stages[index-1].wins);
  });
  assert.equal(result.clears,result.stages.at(-1).wins);
});
