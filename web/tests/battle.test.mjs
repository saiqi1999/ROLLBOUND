import test from 'node:test';
import assert from 'node:assert/strict';
import {adjacent,newRun,buy,startBattle,advance,step,commitRoll,outcome} from '../src/engine.ts';
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
      assert.equal(r.stage,i);startBattle(r);assert.equal(r.battle.hp,undefined);
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
test('historical replays count dead pages and finish declared attacks',()=>{
  const b=field(['king','page'],['king','page']);
  delete b.immediateDeaths;
  b.units.filter(u=>u.kind==='page').forEach(u=>u.hp=1);
  let found=false;
  for(let seed=0;seed<100&&!found;seed++){
    b.rng=seed;const out=step(b);
    if(out.next.units.filter(u=>u.kind==='page'&&u.hp===0).length!==2)continue;
    assert.equal(out.events.filter(e=>e.phase==='攻击').length,4);
    assert.ok(out.next.units.filter(u=>u.kind==='king').every(u=>u.bonus===4));found=true;
  }
  assert.ok(found);
});
test('diagonal pair adds one attack; physician heals the eligible neighbor',()=>{
  const b=field(['guard','archer','medic'],['orc']);b.units[0].hp=8;
  for(let seed=0;seed<2000;seed++){
    b.rng=seed;const out=step(b),grid=out.next.boards[0],g=grid.indexOf('0-0'),a=grid.indexOf('0-1');
    if(Math.abs(g%3-a%3)!==1||Math.abs(Math.floor(g/3)-Math.floor(a/3))!==1||!adjacent(g,grid.indexOf('0-2')))continue;
    const heal=out.events.find(e=>e.action==='heal');
    assert.equal(heal?.source,'0-2');
    assert.equal(heal.target,'0-0');
    assert.equal(heal.state.units[0].hp,11);
    const growth=out.events.find(e=>e.action==='empower'&&e.source==='0-1');
    assert.equal(growth?.target,'0-1');
    assert.equal(out.events.find(e=>e.action==='attack'&&e.source==='0-1').value,'−4');
    return;
  }
  assert.fail('missing diagonal sample');
});

test('read each wheel by rows for links and hits; resolve every neighbor in one beat',()=>{
  const b=field(['guard','guard','archer','archer','guard','archer','archer','archer','guard'],['orc','bone','bone','orc']);
  for(let seed=0;seed<15;seed++){
    b.rng=seed;
    const {next,events}=step(b);
    const order=next.boards.flat().filter(Boolean);
    const links=events.filter(e=>e.phase==='联动');
    const positions=links.map(e=>order.indexOf(e.focus[0]));
    assert.deepEqual(positions,[...positions].sort((x,y)=>x-y));
    assert.equal(new Set(positions).size,positions.length);
    const attacks=events.filter(e=>e.action==='attack').map(e=>order.indexOf(e.source));
    assert.ok(attacks.length>0);
    assert.deepEqual(attacks,[...new Set(attacks)].sort((x,y)=>x-y));
    for(const e of links){
      const source=b.units.find(u=>u.id===e.focus[0]);
      const grid=next.boards[source.side];
      const other={archer:'guard',bone:'orc'}[source.kind];
      const neighbors=grid.filter((id,i)=>id&&adjacent(i,grid.indexOf(source.id))&&b.units.find(u=>u.id===id).kind===other);
      assert.deepEqual(e.focus,[source.id,...neighbors]);
    }
  }
});

test('only a cleared field from round two ends the battle',()=>{
  const empty=field(['archer'],[]);
  assert.equal(step(empty).outcome,undefined);
  empty.round=1;
  const result=step(empty);
  assert.equal(result.outcome,'胜利');
  assert.equal(result.events.some(e=>e.action==='attack'),false);

  const b=field(['page'],['page']);
  b.round=1;
  b.units.forEach(u=>u.hp=1);
  assert.equal(step(b).outcome,'胜利');

  const reserve=field(['page'],['page']);
  reserve.round=2;
  reserve.units[0].field=false;
  assert.equal(outcome(reserve),'落败');
});

test('a guard gains two shield in its attack event, only for itself',()=>{
  const b=field(['guard','archer'],['orc']);
  b.units.forEach(u=>u.field=false);
  const first=step(b);
  assert.ok(first.next.units.every(u=>u.shield===0));
  assert.equal(first.events.some(e=>e.action==='attack'),false);

  const second=step(first.next);
  const hit=second.events.find(e=>e.source==='0-0');
  assert.equal(hit?.shieldGain,2);
  assert.equal(hit.state.units.find(u=>u.id==='0-0').shield,2);
  assert.equal(hit.state.units.find(u=>u.id==='0-1').shield,0);
  assert.equal(second.events.some(e=>e.phase==='联动'&&e.focus[0]==='0-0'),false);
});

test('replays with hero health preserve their old victory and guard shield rules',()=>{
  const b=field(['archer'],[]);
  b.hp=[15,3];
  delete b.immediateDeaths;
  assert.equal(step(b,'legacy').next.hp[1],0);
  assert.equal(step(b,'legacy').outcome,'胜利');

  const oldBoard=field(['guard','archer'],['page']);
  oldBoard.hp=[15,15];
  delete oldBoard.lastingGrowth;
  delete oldBoard.immediateDeaths;
  for(let seed=0;seed<100;seed++){
    oldBoard.rng=seed;
    const roll=step(oldBoard,'legacy');
    const shield=roll.events.find(e=>e.phase==='联动'&&e.focus.length===2&&e.focus[0]==='0-0');
    if(!shield)continue;
    assert.equal(shield.state.units[1].shield,2);
    return;
  }
  assert.fail('missing adjacent legacy guard sample');
});

test('growth follows individual allies across battles, including allies that fell',()=>{
  const r=newRun(23);
  assert.ok(buy(r,1));
  startBattle(r);
  const next=structuredClone(r.battle);
  next.round=1;
  next.units.find(u=>u.id==='0-1').bonus=2;
  next.units.find(u=>u.id==='0-3').bonus=3;
  const king=next.units.find(u=>u.kind==='king');
  king.bonus=4;
  king.hp=0;
  commitRoll(r,{next,events:[],outcome:'胜利'});

  const resumed=JSON.parse(JSON.stringify(r));
  advance(resumed);
  startBattle(resumed);
  const foe=resumed.battle.units.filter(u=>u.side===1);
  assert.ok(foe.every(u=>u.bonus===0));
  assert.equal(resumed.battle.units.find(u=>u.id==='0-1').bonus,2);
  assert.equal(resumed.battle.units.find(u=>u.id==='0-3').bonus,3);
  const revived=resumed.battle.units.find(u=>u.id===king.id);
  assert.equal(revived.bonus,4);
  assert.equal(revived.hp,units.king.hp);
});

test('freshly summoned archer grows once when touching multiple guards',()=>{
  const b=field(Array(8).fill('guard').concat('archer'),['orc']);
  b.units.forEach(u=>u.field=false);
  const {events,next}=step(b);
  const gains=events.filter(e=>e.action==='empower');
  assert.equal(gains.length,1);
  assert.ok(gains[0].focus.length>=3);
  assert.equal(gains[0].state.units.find(u=>u.kind==='archer').bonus,1);
  assert.equal(next.units.find(u=>u.kind==='archer').bonus,1);
  assert.equal(events.some(e=>e.action==='attack'),false);
});


test('a lethal hit immediately removes the target before another attack is chosen',()=>{
  const b=field(['guard','archer'],['page','page']);
  b.round=1;
  b.units.filter(u=>u.side===1).forEach(u=>u.hp=1);
  const roll=step(b);
  const combat=roll.events.filter(e=>e.action==='attack'||e.action==='death');
  assert.deepEqual(combat.map(e=>e.action),['attack','death','attack','death']);
  const [firstHit,firstDeath,secondHit,secondDeath]=combat;
  assert.notEqual(firstHit.target,secondHit.target);
  assert.deepEqual(firstDeath.focus,[firstHit.target]);
  assert.deepEqual(secondDeath.focus,[secondHit.target]);
  assert.ok(combat.filter(e=>e.action==='attack').every(e=>e.source.startsWith('0-')));
  assert.equal(firstHit.state.units.find(u=>u.id===firstHit.target).field,false);
  assert.equal(roll.outcome,'胜利');
});

test('a dead ally remains ineligible for healing on the next roll',()=>{
  const b=field(['medic','page'],['orc']);
  const dead=b.units.find(u=>u.kind==='page');
  dead.hp=0;
  dead.field=false;
  for(let seed=0;seed<20;seed++){
    b.rng=seed;
    const roll=step(b);
    assert.equal(roll.events.some(e=>e.action==='heal'&&e.target===dead.id),false);
    assert.equal(roll.next.units.find(u=>u.id===dead.id).hp,0);
  }
});
