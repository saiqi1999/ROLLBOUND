import test from 'node:test';
import assert from 'node:assert/strict';
import {adjacent,newRun,shop,buy,refreshShop,removalMarkers,removeUnit,migrateExpedition,startBattle,advance,step,commitRoll,outcome,maxHealth,currentAttack} from '../src/engine.ts';
import {encounters,units,unitKinds,spells,spellOffer,GOLD_REWARD,REFRESH_COST} from '../src/data.ts';
function field(ours,theirs){
  const r=newRun(42);startBattle(r);
  r.battle.units=[ours,theirs].flatMap((team,side)=>team.map((kind,i)=>({id:side+'-'+i,kind,side,hp:units[kind].hp,shield:0,bonus:0,field:true})));
  return r.battle;
}
test('an expedition resolves each battle reproducibly and automatically stops after a nonwin',()=>{
  for(let seed=0;seed<24;seed++){
    const r=newRun(seed);
    const openingPrice=r.offers[0].price;
    assert.deepEqual(r.roster,['guard','guard','soldier']);
    assert.ok(buy(r,0));assert.equal(buy(r,0),false);assert.equal(r.roster.length,4);
    for(let i=0;i<7;i++){
      assert.equal(r.stage,i);startBattle(r);assert.equal(r.battle.hp,undefined);
      const first=step(r.battle);assert.deepEqual(first,step(r.battle));assert.equal(first.events.some(e=>e.phase==='攻击'),false);
      assert.deepEqual(first.next,step(r.battle,'board',{captureEvents:false}).next);
      for(let j=0;r.phase==='battle'&&j<101;j++)commitRoll(r,step(r.battle));
      if(r.results.at(-1)!=='胜利'){
        assert.equal(r.phase,'end');
        break;
      }
      assert.equal(r.phase,'result');
      advance(r);
    }
    assert.equal(r.phase,'end');
    assert.equal(r.results.length,r.stage+1);
    assert.ok(r.results.slice(0,-1).every(result=>result==='胜利'));
    assert.equal(r.gold,5-openingPrice+r.stage*GOLD_REWARD);
  }
});

function settleFight(run,result){
  startBattle(run);
  const first=step(run.battle);
  const completed={...first,outcome:result};
  commitRoll(run,completed);
  return completed;
}

test('wins in seven battles grant exactly three bankable markers on even stages',()=>{
  const r=newRun(19);
  for(let stage=0;stage<encounters.length;stage++){
    const result=settleFight(r,'胜利');
    commitRoll(r,result);
    assert.equal(r.phase,'result');
    assert.equal(r.results.length,stage+1);
    assert.equal(removalMarkers(r),Math.floor((stage+1)/2));
    assert.equal(removeUnit(r,0),false);
    advance(r);
  }
  assert.equal(r.phase,'end');
  assert.equal(r.gold,5+6*GOLD_REWARD);
  assert.equal(removalMarkers(r),3);
});

test('a loss or draw on an even stage ends the run without its marker or next shop',()=>{
  for(const result of ['落败','平局']){
    const r=newRun(33);
    settleFight(r,'胜利');
    advance(r);
    settleFight(r,result);
    const finished=structuredClone(r);
    advance(r);
    assert.deepEqual(r,finished);
    assert.equal(r.phase,'end');
    assert.equal(removalMarkers(r),0);
    assert.equal(r.results.at(-1),result);
    assert.equal(r.history.length,1);
  }
});

test('removing a specific copy preserves the surviving units’ growth after reload and recruitment',()=>{
  const r=newRun(7);
  assert.equal(removeUnit(r,0),false);
  r.roster=['guard','archer','archer','king'];
  r.attackGrowth={'0-1':2,'0-2':6,'0-3':4};
  r.healthGrowth={'0-3':4};
  r.stage=2;
  r.results=['胜利','胜利'];
  assert.equal(removeUnit(r,1.1),false);
  assert.equal(removeUnit(r,4),false);
  assert.equal(removalMarkers(r),1);
  assert.equal(removeUnit(r,1),true);
  assert.deepEqual(r.roster,['guard','archer','king']);
  assert.equal(r.gold,5);
  assert.equal(removalMarkers(r),0);
  const reloaded=JSON.parse(JSON.stringify(r));
  assert.equal(removeUnit(reloaded,1),false);
  assert.ok(buy(reloaded,0));
  startBattle(reloaded);
  const [guard,archer,king,recruit]=reloaded.battle.units;
  assert.equal(guard.bonus,0);
  assert.equal(archer.bonus,6);
  assert.equal(king.bonus,4);
  assert.equal(king.hp,16);
  assert.equal(recruit.bonus,0);
  assert.equal(recruit.healthBonus,0);
});

test('old saves derive their bank from completed victories and expire on recorded losses',()=>{
  const r=newRun(3);
  delete r.removalsUsed;
  r.stage=4;
  r.results=Array(4).fill('胜利');
  migrateExpedition(r);
  assert.equal(r.phase,'shop');
  assert.equal(removalMarkers(r),2);
  assert.ok(removeUnit(r,0));
  migrateExpedition(r);
  assert.equal(removalMarkers(r),1);
  const previousLoss={...r,removalsUsed:undefined,results:['胜利','落败','胜利','胜利']};
  migrateExpedition(previousLoss);
  assert.equal(previousLoss.phase,'end');
  assert.equal(previousLoss.results.length,4);
  const completed={...r,removalsUsed:undefined,phase:'end',results:[...Array(6).fill('胜利'),'落败']};
  migrateExpedition(completed);
  assert.equal(completed.legacyClearRequirement,6);
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

test('every shop including the opening has three different single units and one random spell',()=>{
  const available=new Set(),seenSpells=new Set();
  for(let seed=0;seed<120;seed++){
    for(const refresh of [0,1]){
      const offers=shop(seed,0,refresh);
      assert.equal(offers.length,4);
      const stock=offers.slice(0,3).map(offer=>{
        assert.equal(offer.spell,undefined);
        assert.equal(offer.kinds.length,1);
        return offer.kinds[0];
      });
      assert.equal(new Set(stock).size,3);
      stock.forEach(kind=>available.add(kind));
      assert.equal(offers[3].price,spells[offers[3].spell].price);
      assert.deepEqual(offers[3].kinds,[]);
      seenSpells.add(offers[3].spell);
      assert.deepEqual(shop(seed,0,refresh),offers);
    }
  }
  assert.deepEqual(available,new Set(unitKinds));
  assert.deepEqual(seenSpells,new Set(Object.keys(spells)));
});

test('refresh costs one gold, restocks, survives reload, and resets at the next shop',()=>{
  const r=newRun(9);
  r.gold=r.offers[0].price+2;
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

test('shop spell purchases cost gold and enter the next wheel instead of the unit roster',()=>{
  const r=newRun(11);
  r.offers[3]=spellOffer('recruit');
  assert.equal(buy(r,3),true);
  assert.equal(buy(r,3),false);
  assert.equal(r.gold,3);
  assert.deepEqual(r.roster,['guard','guard','soldier']);
  assert.deepEqual(r.spells,['recruit']);
  assert.equal(refreshShop(r),true);
  assert.equal(r.offers.filter(o=>o.spell).length,1);
  const resumed=JSON.parse(JSON.stringify(r));
  startBattle(resumed);
  assert.equal(resumed.battle.units.filter(u=>u.side===0).length,3);
  assert.deepEqual(resumed.battle.spells,[{id:'spell-0',kind:'recruit'}]);
});

test('a drawn surge grows all live adjacent allies including diagonals and is spent across battles',()=>{
  const r=newRun(4);
  r.roster=['page','page','page','page','page','page','page'];
  r.spells=['surge'];
  startBattle(r);
  const checkpoint=r.battle;
  const spentId='spell-0';
  checkpoint.units[0].hp=0;
  for(let seed=0;seed<100;seed++){
    checkpoint.rng=seed;
    const roll=step(checkpoint);
    const board=roll.events[0].state.boards[0];
    const index=board.indexOf(spentId);
    const targets=board.filter((id,slot)=>id?.startsWith('0-')&&id!=='0-0'&&adjacent(index,slot));
    if(!targets.length||targets.length===6||!board.some((id,slot)=>targets.includes(id)&&slot%3!==index%3&&Math.floor(slot/3)!==Math.floor(index/3)))continue;
    const cast=roll.events.find(e=>e.spell==='surge');
    const lastSummon=roll.events.findLastIndex(e=>e.phase==='召唤');
    assert.ok(roll.events.indexOf(cast)>lastSummon);
    assert.deepEqual(cast.valueTargets,targets);
    assert.ok(!roll.next.boards[0].includes(spentId));
    for(const piece of roll.next.units.filter(u=>u.side===0)){
      assert.equal(piece.bonus,targets.includes(piece.id)?2:0);
      assert.equal(maxHealth(piece),units.page.hp+(targets.includes(piece.id)?2:0));
      assert.equal(piece.hp,piece.id==='0-0'?0:maxHealth(piece));
    }
    assert.deepEqual(step(checkpoint),roll);
    commitRoll(r,{...roll,outcome:'胜利'});
    const saved=JSON.parse(JSON.stringify(r));
    assert.deepEqual(saved.spells,[]);
    advance(saved);
    startBattle(saved);
    const pieces=saved.battle.units.filter(u=>u.side===0);
    for(const piece of pieces){
      assert.equal(piece.bonus,targets.includes(piece.id)?2:0);
      assert.equal(piece.hp,units.page.hp+(targets.includes(piece.id)?2:0));
    }
    assert.ok(!step(saved.battle).events.some(e=>e.spell));
    return;
  }
  assert.fail('No board with eligible diagonal and nonadjacent units');
});

test('fireball selects live enemies at random regardless of guarding or armor and skips a slain unit turn',()=>{
  const b=field(['page'],['axeman','orc']);
  b.units.find(u=>u.kind==='orc').shield=999;
  b.spells=[{id:'spell-0',kind:'fireball'}];
  const seen=new Set();
  for(let seed=0;seed<40;seed++){
    b.rng=seed;
    const roll=step(b);
    const cast=roll.events.find(e=>e.spell==='fireball');
    assert.ok(cast.target.startsWith('1-'));
    seen.add(cast.target);
    const victim=roll.next.units.find(u=>u.id===cast.target);
    assert.equal(victim.hp,0);
    assert.equal(victim.shield,0);
    assert.ok(roll.events.some(e=>e.action==='death'&&e.focus.includes(victim.id)));
    assert.ok(!roll.events.some(e=>e.action==='attack'&&e.source===victim.id));
    assert.deepEqual(roll.next.spells,[]);
  }
  assert.deepEqual(seen,new Set(['1-0','1-1']));
});

test('fireball uses the templar death and revival sequence',()=>{
  const b=field(['page'],['templar']);
  b.spells=[{id:'spell-0',kind:'fireball'}];
  const roll=step(b);
  assert.deepEqual(roll.events.map(e=>e.phase).slice(0,4),['停盘','法术','阵亡','复活']);
  assert.equal(roll.next.units[1].revived,true);
  assert.equal(roll.next.units[1].field,true);
  assert.deepEqual(roll.next.spells,[]);
});

test('spells without targets are spent, while an undrawn copy carries into the next battle',()=>{
  const empty=field([],[]);
  empty.spells=[{id:'spell-0',kind:'surge'},{id:'spell-1',kind:'fireball'}];
  const emptyResult=step(empty);
  assert.equal(emptyResult.events.filter(e=>e.spell).length,2);
  assert.deepEqual(emptyResult.next.spells,[]);

  const r=newRun(15);
  r.roster=Array(9).fill('guard');
  r.spells=['surge','surge'];
  startBattle(r);
  for(let seed=0;seed<100;seed++){
    r.battle.rng=seed;
    const roll=step(r.battle);
    if(roll.next.spells.length!==1)continue;
    assert.equal(roll.events.filter(e=>e.spell==='surge').length,1);
    assert.equal(roll.next.units.filter(u=>u.side===0&&u.field).length,8);
    commitRoll(r,{...roll,outcome:'胜利'});
    assert.deepEqual(r.spells,['surge']);
    advance(r);
    startBattle(r);
    assert.deepEqual(r.battle.spells,[{id:'spell-0',kind:'surge'}]);
    return;
  }
  assert.fail('No roll with one undrawn copy');
});

test('summoning circles each recruit one human with permanent growth and wait until a future roll',()=>{
  const r=newRun(31);
  r.spells=['recruit','recruit'];
  startBattle(r);
  const checkpoint=r.battle;
  const first=step(checkpoint);
  const created=first.next.units.filter(u=>['0-3','0-4'].includes(u.id));
  assert.equal(created.length,2);
  assert.equal(first.events.filter(e=>e.spell==='recruit').length,2);
  assert.deepEqual(first.next.spells,[]);
  assert.deepEqual(step(checkpoint),first);
  for(const unit of created){
    assert.equal(units[unit.kind].race,'human');
    assert.equal(currentAttack(unit),units[unit.kind].atk+3);
    assert.equal(unit.hp,units[unit.kind].hp+3);
    assert.equal(maxHealth(unit),unit.hp);
    assert.equal(unit.field,false);
    assert.ok(!first.next.boards[0].includes(unit.id));
  }
  commitRoll(r,first);
  commitRoll(r,first);
  assert.deepEqual(r.roster.slice(3),created.map(u=>u.kind));
  const reloaded=JSON.parse(JSON.stringify(r));
  const next=step(reloaded.battle);
  for(const unit of created){
    assert.ok(next.events.some(e=>e.phase==='召唤'&&e.focus.includes(unit.id)));
  }
  commitRoll(reloaded,{...next,outcome:'胜利'});
  advance(reloaded);
  startBattle(reloaded);
  for(const recruit of created){
    const unit=reloaded.battle.units.find(u=>u.id===recruit.id);
    assert.equal(unit.kind,recruit.kind);
    assert.equal(unit.bonus,3);
    assert.equal(unit.healthBonus,3);
  }
  assert.ok(!step(reloaded.battle).events.some(e=>e.spell==='recruit'));
});
