import {units, encounters, offer, royal, hasGuardian, GOLD_REWARD, REFRESH_COST, type Kind, type Offer} from './data.ts';
export type Side = 0|1;
export const FIELD_LIMIT = 9;
export type Unit = {
  id:string; kind:Kind; side:Side; hp:number; shield:number; bonus:number; field:boolean;
  roundAttackBonus?:number; healthBonus?:number; corpseConsumed?:true;
  battleAttackBonus?:number; battleHealthBonus?:number; revived?:true;
};
export type Battle = {round:number; rng:number; units:Unit[]; boards:(string|null)[][]; hp?:[number,number]; lastingGrowth?:true; immediateDeaths?:true; corpseRules?:true};
export type Moment = {phase:string; text:string; focus:string[]; state:Battle; action?:'attack'|'death'|'heal'|'empower'|'blocked'; source?:string; target?:string; value?:string; valueTargets?:string[]; shieldGain?:number};
export type Outcome = '胜利'|'落败'|'平局';
export type Run = {
  version:1; seed:number; stage:number; gold:number; roster:Kind[];
  attackGrowth?:Record<string,number>; healthGrowth?:Record<string,number>;
  offers:Offer[]; refreshes?:number; removalsUsed?:number;
  legacyThirdBattle?:true; legacyClearRequirement?:number;
  phase:'shop'|'battle'|'result'|'end'; battle:Battle|null;
  results:Outcome[]; log:string[]; history:(Battle & {order?:'board'})[];
};
const copy = <T>(x:T):T => structuredClone(x);
export function currentAttack(unit:Unit){
  return units[unit.kind].atk+unit.bonus+(unit.battleAttackBonus??0)+(unit.roundAttackBonus??0);
}
export function maxHealth(unit:Unit){
  return units[unit.kind].hp+(unit.healthBonus??0)+(unit.battleHealthBonus??0);
}
function grantBattleStats(unit:Unit,attack:number,health:number){
  if(attack)unit.battleAttackBonus=(unit.battleAttackBonus??0)+attack;
  unit.battleHealthBonus=(unit.battleHealthBonus??0)+health;
  unit.hp+=health;
}
export function rng(s:{rng:number}) {
  s.rng=(Math.imul(1664525,s.rng)+1013904223)>>>0;
  return s.rng/4294967296;
}
function pick<T>(items:T[],s:{rng:number}):T { return items[Math.floor(rng(s)*items.length)]; }
function shuffle<T>(items:T[],s:{rng:number}):T[] {
  for(let i=items.length-1;i>0;i--){const j=Math.floor(rng(s)*(i+1));[items[i],items[j]]=[items[j],items[i]];}
  return items;
}
export function shop(seed:number,stage:number,refreshes=0) {
  if(stage===0&&refreshes===0)return [offer(['archer'],3),offer(['swordsman'],3),offer(['lancer'],3),royal()];
  const s={rng:(seed ^ Math.imul(stage+1,0x9e3779b1) ^ Math.imul(refreshes+1,0x85ebca6b))>>>0};
  const attack=pick<Kind>(['archer','swordsman','lancer'],s);
  const support=pick<Kind>(stage>=2?['medic','axeman','templar']:['medic','axeman'],s);
  const basic=pick<Kind>(['guard','soldier'],s);
  return [offer([attack],3),offer([support],support==='templar'?4:3),offer([basic],2),
    rng(s)<.5?royal():offer(['page','page'],2,'纸甲侍从小队')];
}
export function newRun(seed:number):Run {
  return {version:1,seed,stage:0,gold:5,roster:['guard','guard','soldier'],offers:shop(seed,0),refreshes:0,removalsUsed:0,phase:'shop',battle:null,results:[],log:[],history:[]};
}
export function buy(run:Run,index:number) {
  const o=run.offers[index];
  if(run.phase!=='shop'||!o||o.sold||run.gold<o.price)return false;
  run.gold-=o.price;run.roster.push(...o.kinds);o.sold=true;return true;
}
export function refreshShop(run:Run){
  if(run.phase!=='shop'||run.gold<REFRESH_COST)return false;
  run.gold-=REFRESH_COST;
  run.refreshes=(run.refreshes??0)+1;
  run.offers=shop(run.seed,run.stage,run.refreshes);
  return true;
}
export function earnedRemovalMarker(stage:number,result:Outcome|undefined){
  return (stage+1)%2===0&&result==='胜利';
}
export function removalMarkers(run:Run){
  const earned=run.results.filter((result,stage)=>earnedRemovalMarker(stage,result)).length;
  return Math.max(0,earned-(run.removalsUsed??0));
}
function shiftGrowth(growth:Record<string,number>,removed:number,length:number){
  const shifted:Record<string,number>={};
  for(let index=0;index<length;index++){
    const prior=growth['0-'+(index<removed?index:index+1)];
    if(prior!==undefined)shifted['0-'+index]=prior;
  }
  return shifted;
}
export function removeUnit(run:Run,index:number){
  if(run.phase!=='shop'||!Number.isInteger(index)||index<0||index>=run.roster.length||!removalMarkers(run))return false;
  run.roster.splice(index,1);
  // Battle IDs are derived from roster position. Keep both bonuses attached to their owners.
  if(run.attackGrowth)run.attackGrowth=shiftGrowth(run.attackGrowth,index,run.roster.length);
  if(run.healthGrowth)run.healthGrowth=shiftGrowth(run.healthGrowth,index,run.roster.length);
  run.removalsUsed=(run.removalsUsed??0)+1;
  return true;
}
export function startBattle(r:Run){
  if(r.phase!=='shop')return;
  const encounter=encounters[r.stage];
  const us=[r.roster,encounter.units].flatMap((team,side)=>team.map((k,i):Unit=>{
    const id=side+'-'+i;
    const healthBonus=side===0?(r.healthGrowth?.[id]??0):encounter.health;
    const bonus=side===0?(r.attackGrowth?.[id]??0):encounter.attack;
    return {id,kind:k,side:side as Side,hp:units[k].hp+healthBonus,shield:0,bonus,healthBonus,field:false};
  }));
  r.battle={round:0,rng:(r.seed^Math.imul(r.stage+1,2654435761))>>>0,units:us,lastingGrowth:true,immediateDeaths:true,corpseRules:true,boards:[Array(9).fill(null),Array(9).fill(null)]};
  r.history=[];r.log=[];r.phase='battle';
}
export function advance(r:Run) {
  if(r.phase!=='result')return;
  if(r.stage===encounters.length-1){r.phase='end';return;}
  r.stage++;r.gold+=GOLD_REWARD;r.refreshes=0;r.offers=shop(r.seed,r.stage);r.battle=null;r.history=[];r.phase='shop';
}
export function migrateExpedition(run:Run){
  if(run.removalsUsed!==undefined)return;
  run.removalsUsed=0;
  // Preserve the result of expeditions already completed under the earlier scoring rules.
  if(run.phase==='end'||run.results.length===encounters.length){
    run.legacyClearRequirement=run.results.length<encounters.length?2:encounters.length-1;
  }else if(run.results.some(result=>result!=='胜利')){
    run.phase='end';
  }
}
export function adjacent(a:number,b:number) {
  return a>=0&&b>=0&&a!==b&&Math.max(Math.abs(a%3-b%3),Math.abs(Math.floor(a/3)-Math.floor(b/3)))===1;
}
export function outcome(b:Battle):Outcome|undefined {
  // Older replay checkpoints still carry hero HP and use their original victory rule.
  if(b.hp){
    const exhausted=b.units.every(u=>u.hp<=0);
    if(b.hp.every(h=>h>0))return exhausted||b.round>=100?'平局':undefined;
    return b.hp[0]===b.hp[1]?'平局':b.hp[0]>b.hp[1]?'胜利':'落败';
  }
  if(b.round<=1)return;
  const alliesRemain=b.units.some(u=>u.side===0&&u.field&&u.hp>0);
  const enemiesRemain=b.units.some(u=>u.side===1&&u.field&&u.hp>0);
  if(!alliesRemain)return enemiesRemain?'落败':'平局';
  if(!enemiesRemain)return '胜利';
  if(b.round>=100)return '平局';
}
export function step(start:Battle, order:'board'|'legacy'='board', {captureEvents=true}={}) {
  const b=copy(start),events:Moment[]=[];
  const byId=new Map(b.units.map(u=>[u.id,u]));
  const record=(phase:string,text:string,focus:string[]=[],extra:Partial<Moment>={})=>{
    if(captureEvents)events.push({phase,text,focus,state:copy(b),...extra});
  };
  const label=(u:Unit)=>(u.side?'敌方':'我方')+units[u.kind].name;
  const isHuman=(u:Unit)=>u.field&&u.hp>0&&units[u.kind].race==='human';
  const humanAllies=(u:Unit)=>b.units.filter(n=>n.side===u.side&&isHuman(n));
  const neighborsOf=(u:Unit)=>{
    const board=b.boards[u.side],index=board.indexOf(u.id);
    return board.flatMap((id,i)=>id&&adjacent(i,index)?[byId.get(id)!]:[]);
  };
  const recordBuff=(phase:string,u:Unit,targets:Unit[],description:string,value:string,action?:'empower')=>{
    if(!targets.length)return;
    const ids=targets.map(t=>t.id);
    record(phase,label(u)+description,[...new Set([u.id,...ids])],{source:u.id,action,value,valueTargets:ids});
  };
  const grantHumanArmor=(u:Unit,phase:string)=>{
    const allies=humanAllies(u);
    for(const ally of allies)ally.shield+=3;
    recordBuff(phase,u,allies,'使所有友方在场人类获得3点护甲。','+3 甲');
  };
  const selected:Unit[]=[];
  b.round++;
  for(const side of [0,1] as const){
    const pool=b.units.filter(u=>u.side===side&&(u.hp>0||(b.corpseRules&&!u.corpseConsumed)));
    const drawn=shuffle(pool,b).slice(0,9);
    b.boards[side]=shuffle([...drawn.map(u=>u.id),...Array(9-drawn.length).fill(null)],b);
    // Historical checkpoints use draw order so their original target rolls are reproducible.
    const ordered=order==='legacy'?drawn:b.boards[side].flatMap(id=>id?[byId.get(id)!]:[]);
    selected.push(...ordered);
  }
  record('停盘','双方轮盘停定，本轮所有棋子点亮。');
  const fieldCounts=[0,0];
  for(const u of b.units)if(u.field&&u.hp>0)fieldCounts[u.side]++;
  const arrivals=new Set<Unit>(),blocked:Unit[]=[],attackers:Unit[]=[];
  for(const u of selected){
    if(u.hp<=0)continue;
    if(u.field){attackers.push(u);continue;}
    if(b.corpseRules&&fieldCounts[u.side]>=FIELD_LIMIT){blocked.push(u);continue;}
    u.field=true;
    fieldCounts[u.side]++;
    arrivals.add(u);
  }
  if(arrivals.size)record('召唤',arrivals.size+' 名单位登场。',[...arrivals].map(u=>u.id));
  if(blocked.length)record('召唤','场上已满，'+blocked.map(label).join('、')+'未能登场。',blocked.map(u=>u.id),{action:'blocked'});
  for(const u of arrivals){
    if(u.kind==='soldier'){
      const allies=humanAllies(u);
      for(const ally of allies)grantBattleStats(ally,0,1);
      recordBuff('召唤',u,allies,'使所有友方在场人类获得+1生命值。','+1 ♥','empower');
    }
    if(u.kind==='swordsman'){
      const allies=neighborsOf(u).filter(isHuman);
      for(const ally of allies)grantBattleStats(ally,2,2);
      recordBuff('召唤',u,allies,'使相邻的友方在场人类获得+2/+2。','+2/+2','empower');
    }
    if(u.kind==='axeman')grantHumanArmor(u,'召唤');
  }
  const protectedIds=new Set<string>(), multipliers=new Map<string,number>();
  for(const u of selected){
    if(!u.field||u.hp<=0)continue;
    const board=b.boards[u.side],index=board.indexOf(u.id);
    const neighbors=neighborsOf(u);
    const near=neighbors.filter(n=>n.field&&n.hp>0);
    if(u.kind==='lancer'&&board.some((id,i)=>id===null&&adjacent(i,index))){
      grantBattleStats(u,2,1);
      recordBuff('联动',u,[u],'邻接空位，获得+2/+1。','+2/+1','empower');
    }
    if(b.corpseRules&&u.kind==='king'){
      const corpses=neighbors.filter(n=>n.hp<=0&&!n.corpseConsumed);
      if(corpses.length){
        const gain=2*corpses.length;
        u.bonus+=gain;
        u.healthBonus=(u.healthBonus??0)+gain;
        u.hp+=gain;
        for(const corpse of corpses)corpse.corpseConsumed=true;
        record('联动',label(u)+'吞噬'+corpses.length+'具相邻尸体，永久获得+'+gain+'攻击力和+'+gain+'生命值。',
          [u.id,...corpses.map(n=>n.id)],{action:'empower',source:u.id,target:u.id,value:'+'+gain+' 攻 / ♥',valueTargets:[u.id]});
        // Keep the death poses in the linkage snapshot, then clear the consumed slots.
        for(const corpse of corpses)board[board.indexOf(corpse.id)]=null;
      }
    }
    if(b.hp&&u.kind==='guard'){
      const archers=near.filter(n=>n.kind==='archer');
      if(archers.length){
        const targets=[u,...archers].filter(n=>!protectedIds.has(n.id));
        for(const t of targets){t.shield+=2;protectedIds.add(t.id);}
        if(targets.length)record('联动',label(u)+'与弓手相邻，获得2点护盾。',[u.id,...archers.map(n=>n.id)],{value:'+2 盾',valueTargets:targets.map(t=>t.id)});
      }
    }
    if(u.kind==='archer'||u.kind==='bone'){
      const partners=near.filter(n=>n.kind===(u.kind==='archer'?'guard':'orc'));
      if(partners.length){
        const focus=[u.id,...partners.map(n=>n.id)];
        if(u.kind==='archer'&&b.lastingGrowth){
          u.bonus++;
          record('联动',label(u)+'邻接木盾卫士，攻击力+1。',focus,
            {action:'empower',source:u.id,target:u.id,value:'+1 攻',valueTargets:[u.id]});
        }else{
          if(u.kind==='archer')multipliers.set(u.id,2);
          else u.roundAttackBonus=2;
          if(!arrivals.has(u))record('联动',label(u)+(u.kind==='archer'?'与卫士相邻，本次攻击翻倍。':'与兽人相邻，本轮攻击力+2。'),focus);
        }
      }
    }
    if(u.kind==='medic'){
      const candidates=near.filter(n=>n.hp<maxHealth(n));
      if(candidates.length){
        const t=pick(candidates,b),amount=Math.min(3,maxHealth(t)-t.hp);t.hp+=amount;
        record('联动',label(u)+'为'+units[t.kind].name+'恢复'+amount+'点生命。',[u.id,t.id],{action:'heal',source:u.id,target:t.id,value:'+'+amount,valueTargets:[t.id]});
      }
    }
  }
  const chooseTarget=(attacker:Unit)=>{
    const targets=b.units.filter(u=>u.side!==attacker.side&&u.field&&u.hp>0);
    const guardians=targets.filter(u=>hasGuardian(u.kind));
    return targets.length?pick(guardians.length?guardians:targets,b):undefined;
  };
  const attackDamage=(attacker:Unit)=>currentAttack(attacker)*(multipliers.get(attacker.id)??1);
  const applyAttack=(u:Unit,t:Unit|undefined,damage:number)=>{
    if(!t&&!b.hp)return;
    const shieldGain=!b.hp&&u.kind==='guard'&&u.hp>0?2:0;
    u.shield+=shieldGain;
    const other=(1-u.side) as Side;
    if(t){
      const absorbed=Math.min(t.shield,damage);
      t.shield-=absorbed;
      t.hp=Math.max(0,t.hp-damage+absorbed);
      if(t.hp===0&&b.immediateDeaths)t.field=false;
    }else if(b.hp)b.hp[other]=Math.max(0,b.hp[other]-damage);
    const target=t?.id??'hero'+other;
    record('攻击',label(u)+'攻击'+(t?units[t.kind].name:'敌对英雄')+'，造成'+damage+'点伤害'+(shieldGain?'，自身获得2点护盾。':'。'),[u.id,target],{action:'attack',source:u.id,target,value:'−'+damage,shieldGain});
  };
  const resolveDeaths=(dead:Unit[])=>{
    if(!dead.length)return;
    for(const u of dead)u.field=false;
    record('阵亡',dead.map(label).join('、')+(b.corpseRules?'阵亡，尸体留在轮盘池中。':'退出本场。'),dead.map(u=>u.id),{action:'death'});
    if(b.corpseRules)return;
    const count=dead.filter(u=>u.kind==='page').length;
    for(const u of b.units.filter(u=>u.kind==='king'&&u.field&&u.hp>0&&count)){
      u.bonus+=2*count;
      record('阵亡',label(u)+'汲取侍从之力，攻击力+'+2*count+'。',[u.id],{value:'+'+2*count+' 攻'});
    }
  };
  const resolveLethalHit=(u:Unit)=>{
    if(u.kind==='templar'&&!u.revived){
      record('阵亡',label(u)+'倒下，即将复活。',[u.id],{action:'death'});
      u.revived=true;
      u.field=true;
      u.hp=maxHealth(u);
      const allies=humanAllies(u);
      for(const ally of allies)grantBattleStats(ally,1,1);
      recordBuff('复活',u,allies,'满血复活，使所有友方在场人类获得+1/+1。','+1/+1','empower');
      return;
    }
    resolveDeaths([u]);
    if(u.kind==='axeman')grantHumanArmor(u,'阵亡');
  };

  if(b.immediateDeaths){
    for(const attacker of attackers){
      if(!attacker.field||attacker.hp<=0)continue;
      const target=chooseTarget(attacker);
      if(!target)continue;
      applyAttack(attacker,target,attackDamage(attacker));
      if(target.hp===0)resolveLethalHit(target);
    }
  }else{
    // Published replays from before immediate deaths retain their original hit order and RNG.
    const hits=attackers.map(u=>({u,t:chooseTarget(u),damage:attackDamage(u)}));
    const dead=new Set<Unit>();
    for(const {u,t,damage} of hits){
      applyAttack(u,t,damage);
      if(t?.hp===0)dead.add(t);
    }
    resolveDeaths([...dead]);
  }
  for(const u of b.units)delete u.roundAttackBonus;
  return {next:b,events,outcome:outcome(b)};
}
export function commitRoll(r:Run,result:ReturnType<typeof step>){
  if(r.phase!=='battle'||!r.battle||r.battle.round+1!==result.next.round)return;
  r.history.push({...r.battle,order:'board'});r.battle=result.next;r.log.push(...result.events.map(e=>'第'+result.next.round+'摇 · '+e.text));
  if(result.next.lastingGrowth){
    r.attackGrowth=Object.fromEntries(result.next.units.filter(u=>u.side===0&&u.bonus>0).map(u=>[u.id,u.bonus]));
  }
  if(result.next.corpseRules){
    r.healthGrowth=Object.fromEntries(result.next.units.filter(u=>u.side===0&&u.healthBonus).map(u=>[u.id,u.healthBonus!]));
  }
  if(result.outcome){
    r.results.push(result.outcome);
    r.phase=result.outcome==='胜利'?'result':'end';
  }
}
