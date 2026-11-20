import {units, encounters, offer, royal, type Kind, type Offer} from './data.ts';
export type Side = 0|1;
export type Unit = {id:string; kind:Kind; side:Side; hp:number; shield:number; bonus:number; field:boolean};
export type Battle = {round:number; rng:number; units:Unit[]; boards:(string|null)[][]; hp?:[number,number]};
export type Moment = {phase:string; text:string; focus:string[]; state:Battle; action?:'attack'|'death'; source?:string; target?:string; value?:string; valueTargets?:string[]; shieldGain?:number};
export type Outcome = '胜利'|'落败'|'平局';
export type Run = {version:1; seed:number; stage:number; gold:number; roster:Kind[]; offers:Offer[]; phase:'shop'|'battle'|'result'|'end'; battle:Battle|null; results:Outcome[]; log:string[]; history:(Battle & {order?:'board'})[]};
const copy = <T>(x:T):T => structuredClone(x);
export function rng(s:{rng:number}) {
  s.rng=(Math.imul(1664525,s.rng)+1013904223)>>>0;
  return s.rng/4294967296;
}
function pick<T>(items:T[],s:{rng:number}):T { return items[Math.floor(rng(s)*items.length)]; }
function shuffle<T>(items:T[],s:{rng:number}):T[] {
  for(let i=items.length-1;i>0;i--){const j=Math.floor(rng(s)*(i+1));[items[i],items[j]]=[items[j],items[i]];}
  return items;
}
export function shop(seed:number,stage:number) {
  if(stage===0)return [offer(['medic'],3),royal(),offer(['guard'],2)];
  const s={rng:(seed ^ Math.imul(stage,0x9e3779b1))>>>0};
  return [rng(s)<.5?offer(['medic'],3):offer(['guard'],2),rng(s)<.5?royal():offer(['page','page'],2,'纸甲侍从小队'),offer([rng(s)<.5?'guard':'archer'],2)];
}
export function newRun(seed:number):Run {
  return {version:1,seed,stage:0,gold:5,roster:['guard','archer','guard','archer'],offers:shop(seed,0),phase:'shop',battle:null,results:[],log:[],history:[]};
}
export function buy(run:Run,index:number) {
  const o=run.offers[index];
  if(run.phase!=='shop'||!o||o.sold||run.gold<o.price)return false;
  run.gold-=o.price;run.roster.push(...o.kinds);o.sold=true;return true;
}
export function startBattle(r:Run){
  if(r.phase!=='shop')return;
  const us=[r.roster,encounters[r.stage].units].flatMap((team,side)=>team.map((k,i):Unit=>({id:side+'-'+i,kind:k,side:side as Side,hp:units[k].hp,shield:0,bonus:0,field:false})));
  r.battle={round:0,rng:(r.seed^Math.imul(r.stage+1,2654435761))>>>0,units:us,boards:[Array(9).fill(null),Array(9).fill(null)]};
  r.history=[];r.log=[];r.phase='battle';
}
export function advance(r:Run) {
  if(r.phase!=='result')return;
  if(r.stage===2){r.phase='end';return;}
  r.stage++;r.gold+=3;r.offers=shop(r.seed,r.stage);r.battle=null;r.history=[];r.phase='shop';
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
export function step(start:Battle, order:'board'|'legacy'='board') {
  const b=copy(start),events:Moment[]=[];
  const byId=new Map(b.units.map(u=>[u.id,u]));
  const record=(phase:string,text:string,focus:string[]=[],extra:Partial<Moment>={})=>events.push({phase,text,focus,state:copy(b),...extra});
  const label=(u:Unit)=>(u.side?'敌方':'我方')+units[u.kind].name;
  const selected:Unit[]=[];
  b.round++;
  for(const side of [0,1] as const){
    const living=b.units.filter(u=>u.hp>0&&u.side===side);
    const drawn=shuffle([...living],b).slice(0,9);
    b.boards[side]=shuffle([...drawn.map(u=>u.id),...Array(9-drawn.length).fill(null)],b);
    // Historical checkpoints use draw order so their original target rolls are reproducible.
    const ordered=order==='legacy'?drawn:b.boards[side].flatMap(id=>id?[byId.get(id)!]:[]);
    selected.push(...ordered);
  }
  record('停盘','双方轮盘停定，本轮所有棋子点亮。');
  const arrivals=selected.filter(u=>!u.field);
  for(const u of arrivals)u.field=true;
  if(arrivals.length)record('召唤',arrivals.length+' 名单位首次登场。',arrivals.map(u=>u.id));
  const protectedIds=new Set<string>(), multipliers=new Map<string,number>(),extraAttack=new Map<string,number>();
  for(const u of selected){
    const board=b.boards[u.side],index=board.indexOf(u.id);
    const near=board.flatMap((id,i)=>id&&adjacent(i,index)?[byId.get(id)!]:[]);
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
        if(u.kind==='archer')multipliers.set(u.id,2);else extraAttack.set(u.id,2);
        if(!arrivals.includes(u))record('联动',label(u)+(u.kind==='archer'?'与卫士相邻，本次攻击翻倍。':'与兽人相邻，本轮攻击力+2。'),[u.id,...partners.map(n=>n.id)]);
      }
    }
    if(u.kind==='medic'){
      const candidates=near.filter(n=>n.hp<units[n.kind].hp);
      if(candidates.length){
        const t=pick(candidates,b),amount=Math.min(3,units[t.kind].hp-t.hp);t.hp+=amount;
        record('联动',label(u)+'为'+units[t.kind].name+'恢复'+amount+'点生命。',[u.id,t.id],{value:'+'+amount,valueTargets:[t.id]});
      }
    }
  }
  const hits=selected.filter(u=>!arrivals.includes(u)).map(u=>{
    const targets=b.units.filter(n=>n.side!==u.side&&n.field&&n.hp>0);
    return {u,t:targets.length?pick(targets,b):undefined, damage:((units[u.kind].atk+u.bonus)*(multipliers.get(u.id)??1))+(extraAttack.get(u.id)??0)};
  });
  const dead=new Set<Unit>();
  for(const {u,t,damage} of hits){
    // Attacks are declared before damage. A fallen unit can finish its declared hit,
    // but only a living guard can gain a shield.
    if(!t&&!b.hp)continue;
    const shieldGain=!b.hp&&u.kind==='guard'&&u.hp>0?2:0;
    u.shield+=shieldGain;
    const other=(1-u.side) as Side;
    if(t){
      const absorbed=Math.min(t.shield,damage);t.shield-=absorbed;t.hp=Math.max(0,t.hp-damage+absorbed);
      if(t.hp===0)dead.add(t);
    }else if(b.hp)b.hp[other]=Math.max(0,b.hp[other]-damage);
    const target=t?.id??'hero'+other;
    record('攻击',label(u)+'攻击'+(t?units[t.kind].name:'敌对英雄')+'，造成'+damage+'点伤害'+(shieldGain?'，自身获得2点护盾。':'。'),[u.id,target],{action:'attack',source:u.id,target,value:'−'+damage,shieldGain});
  }
  if(dead.size){
    for(const u of dead)u.field=false;
    record('阵亡',[...dead].map(label).join('、')+'退出本场。',[...dead].map(u=>u.id),{action:'death'});
    const count=[...dead].filter(u=>u.kind==='page').length;
    for(const u of b.units.filter(u=>u.kind==='king'&&u.field&&u.hp>0&&count)){
      u.bonus+=2*count;record('阵亡',label(u)+'汲取侍从之力，攻击力+'+2*count+'。',[u.id],{value:'+'+2*count+' 攻'});
    }
  }
  return {next:b,events,outcome:outcome(b)};
}
export function commitRoll(r:Run,result:ReturnType<typeof step>){
  if(r.phase!=='battle'||!r.battle||r.battle.round+1!==result.next.round)return;
  r.history.push({...r.battle,order:'board'});r.battle=result.next;r.log.push(...result.events.map(e=>'第'+result.next.round+'摇 · '+e.text));
  if(result.outcome){r.results.push(result.outcome);r.phase='result';}
}
