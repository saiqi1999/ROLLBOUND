import test from 'node:test';
import assert from 'node:assert/strict';
import {adjacent,newRun,buy,startBattle,advance,step,commitRoll} from '../src/engine.ts';
import {units} from '../src/data.ts';
function field(ours,theirs){
  const r=newRun(42);startBattle(r);
  r.battle.units=[ours,theirs].flatMap((team,side)=>team.map((kind,i)=>({id:side+'-'+i,kind,side,hp:units[kind].hp,shield:0,bonus:0,field:true})));
  return r.battle;
}
test('three shops, three battles, one payment per offer; reproducible replay',()=>{
  for(let seed=0;seed<24;seed++){
    const r=newRun(seed);assert.ok(buy(r,1));assert.equal(buy(r,1),false);assert.equal(r.roster.length,7);
    for(let i=0;i<3;i++){
      assert.equal(r.stage,i);startBattle(r);assert.deepEqual(r.battle.hp,[15,15]);
      const first=step(r.battle);assert.deepEqual(first,step(r.battle));assert.equal(first.events.some(e=>e.phase==='攻击'),false);
      for(let j=0;r.phase==='battle'&&j<101;j++)commitRoll(r,step(r.battle));
      assert.equal(r.phase,'result');advance(r);
    }
    assert.equal(r.phase,'end');assert.equal(r.results.length,3);assert.equal(r.gold,6);
  }
});
test('eight neighbors, shuffled distinct instances, no dead entries',()=>{
  assert.equal([0,1,2,3,4,5,6,7,8].filter(i=>adjacent(4,i)).length,8);
  assert.equal(adjacent(2,3),false);assert.equal(adjacent(0,4),true);
  const b=field(Array(12).fill('guard'),['orc']);b.units[0].hp=0;
  const board=step(b).next.boards[0];assert.equal(new Set(board).size,9);assert.ok(!board.includes('0-0'));
});
test('both teams count dead pages; declared attacks complete, no hero spill',()=>{
  const b=field(['king','page'],['king','page']);
  b.units.filter(u=>u.kind==='page').forEach(u=>u.hp=1);
  let found=false;
  for(let seed=0;seed<100&&!found;seed++){
    b.rng=seed;const out=step(b);
    if(out.next.units.filter(u=>u.kind==='page'&&u.hp===0).length!==2)continue;
    assert.deepEqual(out.next.hp,[15,15]);assert.equal(out.events.filter(e=>e.phase==='攻击').length,4);
    assert.ok(out.next.units.filter(u=>u.kind==='king').every(u=>u.bonus===4));found=true;
  }
  assert.ok(found);
  const empty=field(['archer'],[]);assert.equal(step(empty).next.hp[1],12);
});
test('diagonal pair doubles exactly one attack; physician heals eligible neighbor',()=>{
  const b=field(['guard','archer','medic'],['orc']);b.units[0].hp=8;
  for(let seed=0;seed<2000;seed++){
    b.rng=seed;const out=step(b),grid=out.next.boards[0],g=grid.indexOf('0-0'),a=grid.indexOf('0-1');
    if(Math.abs(g%3-a%3)!==1||Math.abs(Math.floor(g/3)-Math.floor(a/3))!==1||!adjacent(g,grid.indexOf('0-2')))continue;
    const link=out.events.find(e=>e.text.includes('恢复'));assert.ok(link);assert.equal(link.state.units[0].hp,11);
    assert.equal(out.events.find(e=>e.source==='0-1').value,'−6');return;
  }
  assert.fail('missing diagonal sample');
});
