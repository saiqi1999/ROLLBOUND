import {units} from '../data.ts';
import {advanceCombatTick,deployUnit} from './combat.ts';
import {createEffects} from './effects.ts';
import {
  COMBAT,createCombat,DEATHS_PER_REINFORCEMENT,FIELD_LIMIT,
  type Battle,type BattlePlan,type BattleWindow,type Outcome,type RecordMoment,type Unit,
} from './model.ts';
import {shuffle} from './random.ts';
import {deployed,makeUnit} from './unit-state.ts';

function deployClones(battle:Battle,originals:Unit[]){
  const clones:Unit[]=[];
  for(const original of originals){
    if(original.tag!=='clone')continue;
    const {tag,...stats}=original;
    const clone:Unit={...stats,id:original.id+'-clone',temporary:true,cloneOf:original.id};
    battle.units.push(clone);
    deployUnit(battle,clone);
    clones.push(clone);
  }
  return clones;
}

function recordClones(clones:Unit[],record:RecordMoment){
  for(const clone of clones){
    const label=(clone.side?'敌方':'我方')+units[clone.kind].name;
    record('召唤',label+'召唤一个分身。',[clone.id],{
      action:'empower',source:clone.cloneOf,value:'分身',valueTargets:[clone.id],
    });
  }
}

export function createBattle(plan:BattlePlan):Battle{
  const allies=plan.allies.map(({id,kind,gainedAttack,gainedHealth,startingArmor,tag})=>{
    const unit=makeUnit(id,kind,0,gainedAttack,gainedHealth);
    unit.shield=startingArmor;
    if(tag)unit.tag=tag;
    return unit;
  });
  const enemies=plan.enemies.map(({kind,attack,health},index)=>makeUnit('1-'+index,kind,1,attack,health));
  const battle:Battle={
    id:plan.id,units:[...allies,...enemies],reserves:[[],[]],recruitedDeaths:[0,0],
    openingResolved:false,openingSpells:structuredClone(plan.openingSpells),runtime:createCombat(plan.seed),
  };
  const groups=[allies,enemies];
  for(const side of [0,1] as const){
    const random={rng:(plan.seed^Math.imul(side+1,0x2ba9d777))>>>0};
    const order=shuffle(groups[side].slice(),random);
    for(const unit of order.slice(0,FIELD_LIMIT))deployUnit(battle,unit);
    battle.reserves[side]=order.slice(FIELD_LIMIT).map(unit=>unit.id);
  }
  deployClones(battle,battle.units.filter(deployed));
  return battle;
}

function deployReinforcements(battle:Battle,byId:Map<string,Unit>,record:RecordMoment){
  for(const side of [0,1] as const){
    const qualified=Math.floor(battle.recruitedDeaths[side]/DEATHS_PER_REINFORCEMENT);
    battle.recruitedDeaths[side]%=DEATHS_PER_REINFORCEMENT;
    const arriving=battle.reserves[side].splice(0,qualified);
    if(!arriving.length)continue;
    const originals=arriving.map(id=>byId.get(id)!);
    for(const unit of originals)deployUnit(battle,unit);
    record('补员',(side?'敌方':'我方')+'候补入场 '+arriving.length+' 名。',arriving);
    recordClones(deployClones(battle,originals),record);
  }
}

function fieldOutcome(battle:Battle):Outcome|undefined{
  const allies=battle.units.some(unit=>unit.side===0&&deployed(unit));
  const enemies=battle.units.some(unit=>unit.side===1&&deployed(unit));
  if(!allies)return enemies?'落败':'平局';
  if(!enemies)return '胜利';
  if(battle.runtime.tick>=COMBAT.maxTicks)return '平局';
}

export function simulateBattleWindow(start:Battle,{
  captureEvents=true,captureFrames=captureEvents,tickLimit=COMBAT.ticksPerWindow,
}:{captureEvents?:boolean;captureFrames?:boolean;tickLimit?:number}={}):BattleWindow{
  const battle=structuredClone(start),events:BattleWindow['events']=[],ticks:BattleWindow['ticks']=[];
  const byId=new Map(battle.units.map(unit=>[unit.id,unit]));
  const record:RecordMoment=(phase,text,focus=[],detail={})=>{
    if(captureEvents)events.push({phase,text,focus,tick:battle.runtime.tick,...detail});
  };
  const effects=createEffects(battle,record);
  if(!battle.openingResolved){
    battle.openingResolved=true;
    recordClones(battle.units.filter(unit=>unit.cloneOf),record);
    for(const spell of battle.openingSpells){
      effects.fireball(spell.id);
      deployReinforcements(battle,byId,record);
    }
    battle.openingSpells=[];
    if(captureFrames&&events.length)ticks.push({state:structuredClone(battle),from:0,until:events.length,opening:true});
  }

  let outcome=fieldOutcome(battle);
  for(let i=0;i<tickLimit&&!outcome;i++){
    const from=events.length;
    advanceCombatTick(battle,{
      motion:()=>record('移动','单位正在接近目标。'),
      attack:effects.attack,
    });
    deployReinforcements(battle,byId,record);
    if(captureFrames)ticks.push({state:structuredClone(battle),from,until:events.length});
    outcome=fieldOutcome(battle);
  }
  return {startTick:start.runtime.tick,startedAfterOpening:start.openingResolved,next:battle,events,ticks,outcome};
}
