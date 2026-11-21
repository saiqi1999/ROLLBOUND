import test from 'node:test';
import assert from 'node:assert/strict';
import {newRun,canStartBattle} from '../src/engine.ts';
import {spellOffer,unitOffer} from '../src/data.ts';
import {simulateDifficulty,spendShopGold} from '../scripts/simulate-difficulty.mjs';

test('the simulated opening spends the best affordable combination and recruits a unit',()=>{
  const run=newRun(1);
  run.gold=6;
  run.offers=[unitOffer('king'),unitOffer('soldier'),unitOffer('medic'),spellOffer('fireball')];
  spendShopGold(run);
  assert.equal(run.gold,0);
  assert.equal(run.refreshes,0);
  assert.deepEqual(run.roster,['soldier']);
  assert.deepEqual(run.spells,['fireball']);
  assert.ok(canStartBattle(run));
});

test('the simulated shop carries its last coin when a refresh cannot lead to a purchase',()=>{
  const run=newRun(3);
  run.stage=1;
  run.gold=1;
  run.offers=[unitOffer('king'),unitOffer('soldier'),unitOffer('medic'),spellOffer('fireball')];
  spendShopGold(run);
  assert.equal(run.gold,1);
  assert.equal(run.refreshes,0);
});

test('simulation is seeded and only sends surviving runs to the next encounter',()=>{
  const result=simulateDifficulty(24,100000);
  assert.deepEqual(result,simulateDifficulty(24,100000));
  assert.equal(result.stages[0].reached,24);
  result.stages.forEach((stage,i)=>{
    assert.equal(stage.reached,stage.wins+stage.losses+stage.draws);
    assert.ok(stage.unspent<=stage.reached);
    if(i>0)assert.equal(stage.reached,result.stages[i-1].wins);
  });
  assert.equal(result.clears,result.stages.at(-1).wins);
});
