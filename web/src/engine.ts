import {unitKinds,spellKinds,spellOffer,encounters,unitOffer,GOLD_REWARD,REFRESH_COST,type Kind,type Offer,type SpellKind} from './data.ts';
import {advanceCombatTick,queueSkill,spawnActor} from './battle/combat.ts';
import {createEffects,label} from './battle/effects.ts';
import {COMBAT,createCombat,type CombatRuntime} from './battle/model.ts';
import {pick,shuffle} from './battle/random.ts';
import {deployed,makeUnit} from './battle/unit-state.ts';
import {FIELD_LIMIT,LAST_ROLL,WHEEL_SIZE,drawBoard,neighborSlots} from './battle/wheel.ts';

export {currentAttack,maxHealth} from './battle/unit-state.ts';
export {adjacent,FIELD_LIMIT} from './battle/wheel.ts';
export type Side = 0|1;
export type Unit = {
  id:string;kind:Kind;side:Side;hp:number;shield:number;bonus:number;healthBonus:number;field:boolean;
  nextAttackBonus?:number;corpseConsumed?:true;battleAttackBonus?:number;battleHealthBonus?:number;revived?:true;
};
export type Battle = {
  round:number;rng:number;units:Unit[];boards:(string|null)[][];spells:{id:string;kind:SpellKind}[];
  spellCasts:number;runtime:CombatRuntime;
};
type Phase = '停盘'|'召唤'|'法术'|'联动'|'移动'|'攻击'|'阵亡'|'复活';
export type Moment = {
  phase:Phase;text:string;focus:string[];state:Battle;originRoll?:number;
  action?:'attack'|'death'|'heal'|'empower'|'blocked';spell?:SpellKind;
  source?:string;target?:string;value?:string;valueTargets?:string[];shieldGain?:number;
};
export type RecordMoment = (
  phase:Phase,text:string,focus?:string[],
  detail?:Omit<Moment,'phase'|'text'|'focus'|'state'>
)=>void;
export type Outcome = '胜利'|'落败'|'平局';
export type Run = {
  version:2;seed:number;stage:number;gold:number;roster:Kind[];spells:SpellKind[];spellCasts:number;
  attackGrowth:Record<string,number>;healthGrowth:Record<string,number>;
  offers:Offer[];refreshes:number;removalsUsed:number;
  phase:'shop'|'battle'|'result'|'end';battle:Battle|null;
  results:Outcome[];log:string[];history:Battle[];
};

export function shop(seed:number,stage:number,refreshes=0) {
  const s={rng:(seed ^ Math.imul(stage+1,0x9e3779b1) ^ Math.imul(refreshes+1,0x85ebca6b))>>>0};
  const offers=shuffle([...unitKinds],s).slice(0,3).map(unitOffer);
  offers.push(spellOffer(pick(spellKinds,s)));
  return offers;
}
export function newRun(seed:number):Run {
  return {version:2,seed,stage:0,gold:5,roster:['guard','guard','soldier'],offers:shop(seed,0),spells:[],spellCasts:0,attackGrowth:{},healthGrowth:{},refreshes:0,removalsUsed:0,phase:'shop',battle:null,results:[],log:[],history:[]};
}
export function buy(run:Run,index:number) {
  const o=run.offers[index];
  if(run.phase!=='shop'||!o||o.sold||run.gold<o.price)return false;
  run.gold-=o.price;
  if(o.spell)run.spells.push(o.spell);
  else run.roster.push(...o.kinds);
  o.sold=true;
  return true;
}
export function refreshShop(run:Run){
  if(run.phase!=='shop'||run.gold<REFRESH_COST)return false;
  run.gold-=REFRESH_COST;
  run.refreshes=run.refreshes+1;
  run.offers=shop(run.seed,run.stage,run.refreshes);
  return true;
}
export function earnedRemovalMarker(stage:number,result:Outcome|undefined){
  return (stage+1)%2===0&&result==='胜利';
}
export function removalMarkers(run:Run){
  const earned=run.results.filter((result,stage)=>earnedRemovalMarker(stage,result)).length;
  return Math.max(0,earned-run.removalsUsed);
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
  run.attackGrowth=shiftGrowth(run.attackGrowth,index,run.roster.length);
  run.healthGrowth=shiftGrowth(run.healthGrowth,index,run.roster.length);
  run.removalsUsed=run.removalsUsed+1;
  return true;
}
export function startBattle(r:Run){
  if(r.phase!=='shop')return;
  const encounter=encounters[r.stage];
  const allies=r.roster.map((kind,index)=>makeUnit(kind,0,index,r.attackGrowth['0-'+index]??0,r.healthGrowth['0-'+index]??0));
  const enemies=encounter.units.map((kind,index)=>makeUnit(kind,1,index,encounter.attack,encounter.health));
  const seed=(r.seed^Math.imul(r.stage+1,2654435761))>>>0;
  r.battle={
    round:0,rng:seed,units:[...allies,...enemies],
    spells:r.spells.map((kind,index)=>({id:'spell-'+index,kind})),spellCasts:r.spellCasts,
    boards:[Array(WHEEL_SIZE).fill(null),Array(WHEEL_SIZE).fill(null)],runtime:createCombat(seed),
  };
  r.history=[];r.log=[];r.phase='battle';
}
export function advance(r:Run) {
  if(r.phase!=='result')return;
  if(r.stage===encounters.length-1){r.phase='end';return;}
  r.stage++;r.gold+=GOLD_REWARD;r.refreshes=0;r.offers=shop(r.seed,r.stage);r.battle=null;r.history=[];r.phase='shop';
}

function fieldOutcome(battle:Battle):Outcome|undefined{
  if(battle.round<=1)return;
  const allies=battle.units.some(unit=>unit.side===0&&deployed(unit));
  const enemies=battle.units.some(unit=>unit.side===1&&deployed(unit));
  if(!allies)return enemies?'落败':'平局';
  if(!enemies)return '胜利';
}

export function step(start:Battle,{captureEvents=true}={}){
  const battle=structuredClone(start),events:Moment[]=[];
  const byId=new Map(battle.units.map(unit=>[unit.id,unit]));
  const record:RecordMoment=(phase,text,focus=[],detail={})=>{
    if(captureEvents)events.push({phase,text,focus,state:structuredClone(battle),...detail});
  };
  const effects=createEffects(battle,byId,record);
  const selected:Unit[]=[];
  battle.round++;
  for(const side of [0,1] as const){
    const board=drawBoard(battle,side);
    battle.boards[side]=board;
    for(const id of board){
      const unit=id&&byId.get(id);
      if(unit)selected.push(unit);
    }
  }
  record('停盘','双方轮盘停定。',battle.boards.flatMap(board=>board.filter((id):id is string=>id!==null)));

  const fieldCounts=[0,0];
  for(const unit of battle.units)if(deployed(unit))fieldCounts[unit.side]++;
  const arrivals:Unit[]=[],blocked:Unit[]=[];
  for(const unit of selected){
    if(unit.hp<=0||unit.field)continue;
    if(fieldCounts[unit.side]>=FIELD_LIMIT){blocked.push(unit);continue;}
    unit.field=true;
    fieldCounts[unit.side]++;
    spawnActor(battle,unit);
    arrivals.push(unit);
  }
  if(arrivals.length)record('召唤',arrivals.length+' 名单位登场。',arrivals.map(unit=>unit.id));
  if(blocked.length)record('召唤','场上已满，'+blocked.map(label).join('、')+'未能登场。',blocked.map(unit=>unit.id),{action:'blocked'});
  for(const unit of arrivals)effects.enter(unit);
  effects.castSpells();
  for(const unit of selected){
    if(!deployed(unit))continue;
    const slots=neighborSlots(battle.boards[unit.side],unit.id);
    const neighbors=effects.skillCandidates(unit,slots);
    if(neighbors.length)queueSkill(battle,unit,neighbors);
  }

  const limit=battle.round===1?COMBAT.openingTicks:COMBAT.ticksPerRoll;
  let result=fieldOutcome(battle);
  for(let i=0;i<limit&&!result;i++){
    advanceCombatTick(battle,{
      skill:effects.skill,
      motion:()=>record('移动','在场单位接近各自的目标。'),
      attack:effects.attack,
    });
    result=fieldOutcome(battle);
  }
  if(!result&&battle.round>=LAST_ROLL)result='平局';
  return {next:battle,events,outcome:result};
}

export function commitRoll(run:Run,result:ReturnType<typeof step>){
  if(run.phase!=='battle'||!run.battle||run.battle.round+1!==result.next.round)return;
  run.history.push(run.battle);
  run.battle=result.next;
  run.log.push(...result.events.filter(event=>event.phase!=='移动').map(event=>'第'+result.next.round+'摇 · '+event.text));
  const allies=result.next.units.filter(unit=>unit.side===0);
  for(const unit of allies.slice(run.roster.length))run.roster.push(unit.kind);
  run.attackGrowth=Object.fromEntries(allies.filter(unit=>unit.bonus>0).map(unit=>[unit.id,unit.bonus]));
  run.healthGrowth=Object.fromEntries(allies.filter(unit=>unit.healthBonus>0).map(unit=>[unit.id,unit.healthBonus]));
  run.spells=result.next.spells.map(spell=>spell.kind);
  run.spellCasts=result.next.spellCasts;
  if(result.outcome){
    run.results.push(result.outcome);
    run.phase=result.outcome==='胜利'?'result':'end';
  }
}
