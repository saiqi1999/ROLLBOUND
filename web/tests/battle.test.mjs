import test from 'node:test';
import assert from 'node:assert/strict';
import {adjacent,newRun,shop,buy,refreshShop,startBattle,advance,step,commitRoll,outcome,maxHealth,currentAttack} from '../src/engine.ts';
import {encounters,units,GOLD_REWARD,REFRESH_COST} from '../src/data.ts';
function field(ours,theirs){
  const r=newRun(42);startBattle(r);
  r.battle.units=[ours,theirs].flatMap((team,side)=>team.map((kind,i)=>({id:side+'-'+i,kind,side,hp:units[kind].hp,shield:0,bonus:0,field:true})));
  return r.battle;
}
test('seven shops, seven battles, one payment per offer; reproducible replay',()=>{
  for(let seed=0;seed<24;seed++){
    const r=newRun(seed);
    assert.deepEqual(r.roster,['guard','guard','soldier']);
    assert.ok(buy(r,0));assert.equal(buy(r,0),false);assert.equal(r.roster.length,4);
    for(let i=0;i<7;i++){
      assert.equal(r.stage,i);startBattle(r);assert.equal(r.battle.hp,undefined);
      const first=step(r.battle);assert.deepEqual(first,step(r.battle));assert.equal(first.events.some(e=>e.phase==='攻击'),false);
      assert.deepEqual(first.next,step(r.battle,'board',{captureEvents:false}).next);
      for(let j=0;r.phase==='battle'&&j<101;j++)commitRoll(r,step(r.battle));
      assert.equal(r.phase,'result');advance(r);
    }
    assert.equal(r.phase,'end');assert.equal(r.results.length,7);assert.equal(r.gold,2+6*GOLD_REWARD);
  }
});
test('eight neighbors, shuffled distinct instances, former replays omit corpses',()=>{
  assert.equal([0,1,2,3,4,5,6,7,8].filter(i=>adjacent(4,i)).length,8);
  assert.equal(adjacent(2,3),false);assert.equal(adjacent(0,4),true);
  const b=field(Array(12).fill('guard'),['orc']);b.units[0].hp=0;
  delete b.corpseRules;
  const board=step(b).next.boards[0];assert.equal(new Set(board).size,9);assert.ok(!board.includes('0-0'));
});
test('historical replays count dead pages and finish declared attacks',()=>{
  const b=field(['king','page'],['king','page']);
  delete b.immediateDeaths;
  delete b.corpseRules;
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
  delete b.corpseRules;
  assert.equal(step(b,'legacy').next.hp[1],0);
  assert.equal(step(b,'legacy').outcome,'胜利');

  const oldBoard=field(['guard','archer'],['page']);
  oldBoard.hp=[15,15];
  delete oldBoard.lastingGrowth;
  delete oldBoard.immediateDeaths;
  delete oldBoard.corpseRules;
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
  r.roster.push('archer','archer','king');
  startBattle(r);
  const next=structuredClone(r.battle);
  next.round=1;
  next.units.find(u=>u.id==='0-1').bonus=2;
  next.units.find(u=>u.id==='0-3').bonus=3;
  const king=next.units.find(u=>u.kind==='king');
  king.bonus=4;
  king.healthBonus=4;
  king.hp=0;
  commitRoll(r,{next,events:[],outcome:'胜利'});

  const resumed=JSON.parse(JSON.stringify(r));
  advance(resumed);
  startBattle(resumed);
  const foe=resumed.battle.units.filter(u=>u.side===1);
  assert.ok(foe.every(u=>u.bonus===encounters[1].attack&&u.healthBonus===encounters[1].health));
  assert.equal(resumed.battle.units.find(u=>u.id==='0-1').bonus,2);
  assert.equal(resumed.battle.units.find(u=>u.id==='0-3').bonus,3);
  const revived=resumed.battle.units.find(u=>u.id===king.id);
  assert.equal(revived.bonus,4);
  assert.equal(revived.hp,units.king.hp+4);
  assert.equal(maxHealth(revived),revived.hp);
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

test('a corpse occupies a slot without summoning, attacking or receiving healing',()=>{
  const b=field(['medic','page'],['orc']);
  const dead=b.units.find(u=>u.kind==='page');
  dead.hp=0;
  dead.field=false;
  for(let seed=0;seed<20;seed++){
    b.rng=seed;
    const roll=step(b);
    assert.ok(roll.next.boards[0].includes(dead.id));
    assert.ok(roll.events.every(e=>e.source!==dead.id&&e.target!==dead.id));
    assert.equal(roll.events.some(e=>e.phase==='召唤'&&e.focus.includes(dead.id)),false);
    assert.equal(roll.events.some(e=>e.action==='heal'&&e.target===dead.id),false);
    assert.equal(roll.next.units.find(u=>u.id===dead.id).hp,0);
  }
});

test('the tenth unit waits at a full field and can summon when a slot opens',()=>{
  const b=field([...Array(9).fill('archer'),'guard'],['orc']);
  const reserve=b.units[9];
  reserve.field=false;
  let blocked;
  for(let seed=0;seed<100&&!blocked;seed++){
    b.rng=seed;
    blocked=step(b).events.find(e=>e.action==='blocked');
  }
  assert.deepEqual(blocked?.focus,[reserve.id]);
  const full=step(b);
  assert.equal(full.next.units[9].field,false);
  assert.equal(full.events.some(e=>e.phase==='联动'||e.source===reserve.id),false);
  assert.equal(blocked.state.units.filter(u=>u.side===0&&u.field).length,9);

  b.units[0].hp=0;
  b.units[0].field=false;
  const roll=step(b);
  assert.ok(roll.events.some(e=>e.phase==='召唤'&&e.action!=='blocked'&&e.focus.includes(reserve.id)));
  assert.equal(roll.events.some(e=>e.action==='attack'&&e.source===reserve.id),false);
});

test('the first adjacent king consumes every shared corpse once and grows before attacking',()=>{
  const b=field(['king','king','page','archer'],['orc']);
  const corpseIds=['0-2','0-3'];
  b.units.slice(2,4).forEach(u=>{u.hp=0;u.field=false;});
  b.units.slice(0,2).forEach(u=>{u.hp=8;});
  for(let seed=0;seed<100;seed++){
    b.rng=seed;
    const {next,events}=step(b);
    const grid=events[0].state.boards[0];
    const kings=grid.filter(id=>id==='0-0'||id==='0-1');
    if(!kings.every(id=>corpseIds.every(corpse=>adjacent(grid.indexOf(id),grid.indexOf(corpse)))))continue;
    const gains=events.filter(e=>e.action==='empower');
    assert.equal(gains.length,1);
    const gain=gains[0];
    assert.equal(gain.source,kings[0]);
    assert.deepEqual(gain.focus,[kings[0],...grid.filter(id=>corpseIds.includes(id))]);
    const king=gain.state.units.find(u=>u.id===kings[0]);
    assert.equal(king.bonus,4);
    assert.equal(king.hp,12);
    assert.equal(maxHealth(king),16);
    assert.equal(events.find(e=>e.action==='attack'&&e.source===king.id).value,'−7');
    for(const id of corpseIds){
      assert.ok(gain.state.boards[0].includes(id));
      assert.equal(next.units.find(u=>u.id===id).corpseConsumed,true);
      assert.ok(!next.boards[0].includes(id));
      assert.ok(!step(next).events[0].state.boards[0].includes(id));
    }
    return;
  }
  assert.fail('missing two kings with shared neighbors');
});

test('all human recruits are offered individually',()=>{
  const available=new Set();
  for(let seed=0;seed<100;seed++){
    for(let stage=0;stage<7;stage++){
      for(const listing of shop(seed,stage)){
        if(!listing.kinds.some(k=>units[k].race==='human'))continue;
        assert.equal(listing.kinds.length,1);
        available.add(listing.kinds[0]);
      }
    }
  }
  assert.deepEqual(available,new Set(['archer','swordsman','lancer','medic','axeman','templar','guard','soldier']));
});

test('refresh costs one gold, restocks, survives reload, and resets at the next shop',()=>{
  const r=newRun(9);
  assert.ok(buy(r,0));
  const roster=[...r.roster],before=structuredClone(r.offers);
  assert.ok(refreshShop(r));
  assert.equal(r.gold,2-REFRESH_COST);
  assert.deepEqual(r.roster,roster);
  assert.notDeepEqual(r.offers,before);
  assert.ok(r.offers.every(o=>!o.sold));
  const resumed=JSON.parse(JSON.stringify(r));
  assert.ok(refreshShop(r));assert.ok(refreshShop(resumed));
  assert.deepEqual(r,resumed);
  assert.equal(r.gold,0);
  const snapshot=structuredClone(r);
  assert.equal(refreshShop(r),false);
  assert.deepEqual(r,snapshot);
  startBattle(r);
  r.gold=1;
  assert.equal(refreshShop(r),false);
  const first=step(r.battle);
  commitRoll(r,{...first,outcome:'胜利'});
  advance(r);
  assert.equal(r.refreshes,0);
  assert.deepEqual(r.offers,shop(r.seed,1));
});

test('entry bonuses reach the correct deployed humans, including diagonal neighbors',()=>{
  const b=field(['soldier','swordsman','archer','page'],['guard']);
  b.units.forEach(u=>{u.field=false;});
  for(let seed=0;seed<100;seed++){
    b.rng=seed;
    const {events,next}=step(b);
    const grid=next.boards[0],a=grid.indexOf('0-1'),c=grid.indexOf('0-2');
    if(Math.abs(a%3-c%3)!==1||Math.abs(Math.floor(a/3)-Math.floor(c/3))!==1)continue;
    const soldier=events.find(e=>e.source==='0-0');
    assert.deepEqual(soldier.valueTargets,['0-0','0-1','0-2']);
    const sword=events.find(e=>e.source==='0-1');
    assert.ok(sword.valueTargets.includes('0-2'));
    assert.ok(!sword.valueTargets.includes('0-1'));
    assert.ok(!sword.valueTargets.includes('0-3'));
    const archer=next.units[2];
    assert.equal(currentAttack(archer),5);
    assert.equal(archer.hp,10);
    assert.equal(maxHealth(archer),10);
    assert.equal(next.units[3].hp,3);
    assert.equal(next.units[4].hp,12);
    assert.ok(step(next).events.every(e=>e.phase!=='召唤'));
    return;
  }
  assert.fail('missing diagonal entry sample');
});

test('a full field suppresses the blocked soldier’s entry effect',()=>{
  const b=field([...Array(9).fill('archer'),'soldier'],['orc']);
  const soldier=b.units[9];
  soldier.field=false;
  for(let seed=0;seed<100;seed++){
    b.rng=seed;
    const result=step(b);
    if(!result.events.some(e=>e.action==='blocked'&&e.focus.includes(soldier.id)))continue;
    assert.ok(!result.events.some(e=>e.source===soldier.id));
    assert.equal(result.next.units[0].battleHealthBonus,undefined);
    return;
  }
  assert.fail('missing blocked soldier sample');
});

test('a guardian receives attacks first and axeman armor resolves on entry and death',()=>{
  const b=field(['orc','orc'],['axeman','archer','page']);
  const [,,axe,archer,page]=b.units;
  axe.field=false;
  const first=step(b);
  const entry=first.events.find(e=>e.phase==='召唤'&&e.source===axe.id);
  assert.deepEqual(entry.valueTargets,[axe.id,archer.id]);
  assert.ok(first.events.filter(e=>e.action==='attack'&&e.source.startsWith('0-')).every(e=>e.target===axe.id));

  axe.field=true;
  axe.hp=1;
  const {events}=step(b);
  const hits=events.filter(e=>e.action==='attack'&&e.source.startsWith('0-'));
  assert.equal(hits[0].target,axe.id);
  assert.notEqual(hits[1].target,axe.id);
  const armor=events.find(e=>e.phase==='阵亡'&&e.source===axe.id);
  assert.deepEqual(armor.valueTargets,[archer.id]);
  assert.equal(armor.state.units.find(u=>u.id===archer.id).shield,3);
  assert.equal(armor.state.units.find(u=>u.id===page.id).shield,0);
  assert.ok(events.indexOf(armor)<events.indexOf(hits[1]));
});

test('a lancer gains once with an adjacent vacancy and corpses fill wheel slots',()=>{
  const b=field(['lancer',...Array(8).fill('page')],['orc']);
  const ready=b.units[0];
  b.units.slice(1,9).forEach(u=>{u.field=false;u.hp=0;});
  assert.ok(step(b).events.every(e=>e.source!==ready.id||e.phase!=='联动'));
  for(let seed=0;seed<100;seed++){
    b.rng=seed;
    b.units[1].corpseConsumed=true;
    const result=step(b);
    const grid=result.next.boards[0];
    if(!adjacent(grid.indexOf(ready.id),grid.indexOf(null)))continue;
    const gains=result.events.filter(e=>e.phase==='联动'&&e.source===ready.id);
    assert.equal(gains.length,1);
    assert.equal(currentAttack(gains[0].state.units[0]),4);
    assert.equal(maxHealth(gains[0].state.units[0]),7);
    return;
  }
  assert.fail('missing empty adjacent slot');
});

test('a templar revives at its boosted max health, keeps guarding, then leaves a corpse',()=>{
  const b=field(['orc','orc','orc'],['templar','archer','bone']);
  b.units.slice(0,3).forEach(u=>{u.bonus=20;});
  const [, , ,templar,archer,bone]=b.units;
  templar.hp=1;
  templar.battleHealthBonus=2;
  const {next,events}=step(b);
  const hits=events.filter(e=>e.action==='attack'&&e.source.startsWith('0-'));
  assert.equal(hits.length,3);
  assert.equal(hits[0].target,templar.id);
  assert.equal(hits[1].target,templar.id);
  assert.notEqual(hits[2].target,templar.id);
  const revivals=events.filter(e=>e.phase==='复活');
  assert.equal(revivals.length,1);
  const revive=revivals[0];
  assert.deepEqual(revive.valueTargets,[templar.id,archer.id]);
  const risen=revive.state.units.find(u=>u.id===templar.id);
  assert.equal(risen.hp,12);
  assert.equal(maxHealth(risen),12);
  assert.equal(currentAttack(risen),3);
  assert.ok(risen.field&&risen.revived);
  assert.equal(next.units.find(u=>u.id===templar.id).hp,0);
  assert.ok(step(next).events[0].state.boards[1].includes(templar.id));
  assert.equal(revive.state.units.find(u=>u.id===bone.id).battleHealthBonus,undefined);
});

test('human stat buffs and revive usage reset between fights',()=>{
  const r=newRun(7);
  r.roster.push('templar');
  startBattle(r);
  const next=structuredClone(r.battle);
  next.round=1;
  const knight=next.units.find(u=>u.kind==='templar');
  knight.battleAttackBonus=4;
  knight.battleHealthBonus=3;
  knight.revived=true;
  commitRoll(r,{next,events:[],outcome:'胜利'});
  advance(r);
  startBattle(r);
  const fresh=r.battle.units.find(u=>u.kind==='templar');
  assert.equal(fresh.revived,undefined);
  assert.equal(currentAttack(fresh),2);
  assert.equal(maxHealth(fresh),9);
  assert.equal(fresh.hp,9);
});
