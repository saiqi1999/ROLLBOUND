import {humanKinds,ORC_EVOLUTION_KILLS,RECRUIT_GAIN,spells,units,wizardEntryGain} from '../data.ts';
import type {Battle,RecordMoment,Unit} from '../engine.ts';
import {interruptActor,reviveActor} from './combat.ts';
import type {WheelSkill} from './model.ts';
import {pick} from './random.ts';
import {currentAttack,deployed,grantBattleStats,grantPermanentStats,makeUnit,maxHealth} from './unit-state.ts';
import {neighborSlots} from './wheel.ts';

export const label=(unit:Unit)=>(unit.side?'敌方':'我方')+units[unit.kind].name;
const isHuman=(unit:Unit)=>deployed(unit)&&units[unit.kind].race==='human';
const isOrc=(unit:Unit)=>deployed(unit)&&units[unit.kind].race==='orc';
const isCorpse=(unit:Unit)=>unit.hp<=0&&!unit.corpseConsumed;

export function createEffects(battle:Battle,byId:Map<string,Unit>,record:RecordMoment){
  const neighbors=(slots:(string|null)[])=>slots.flatMap(id=>{
    const unit=id&&byId.get(id);
    return unit?[unit]:[];
  });
  const humanAllies=(source:Unit)=>battle.units.filter(other=>other.side===source.side&&isHuman(other));
  const buff=(
    phase:'召唤'|'复活'|'阵亡'|'攻击',source:Unit,targets:Unit[],
    description:string,value:string,action?:'empower',
  )=>{
    if(!targets.length)return;
    const ids=targets.map(unit=>unit.id);
    record(phase,label(source)+description,[...new Set([source.id,...ids])],{source:source.id,action,value,valueTargets:ids});
  };
  const grantHumanArmor=(source:Unit,phase:'召唤'|'阵亡')=>{
    const allies=humanAllies(source);
    for(const ally of allies)ally.shield+=3;
    buff(phase,source,allies,'使所有友方在场人类获得3点护甲。','+3 甲');
  };

  function enter(unit:Unit){
    if(unit.kind==='soldier'){
      const allies=humanAllies(unit);
      for(const ally of allies)grantBattleStats(ally,0,1);
      buff('召唤',unit,allies,'使所有友方在场人类获得+1生命值。','+1 ♥','empower');
    }
    if(unit.kind==='swordsman'){
      const allies=neighbors(neighborSlots(battle.boards[unit.side],unit.id)).filter(isHuman);
      for(const ally of allies)grantBattleStats(ally,2,2);
      buff('召唤',unit,allies,'使相邻的友方在场人类获得+2/+2。','+2/+2','empower');
    }
    if(unit.kind==='wizard'){
      const allies=neighbors(neighborSlots(battle.boards[unit.side],unit.id)).filter(deployed);
      const gain=wizardEntryGain(unit.side===0?battle.spellCasts:0);
      for(const ally of allies)grantBattleStats(ally,gain,gain);
      const value='+'+gain+'/+'+gain;
      buff('召唤',unit,allies,'使相邻的友方在场单位获得'+value+'。',value,'empower');
    }
    if(unit.kind==='axeman')grantHumanArmor(unit,'召唤');
  }

  function fall(unit:Unit){
    unit.field=false;
    interruptActor(battle,unit);
  }

  function resolveLethalHit(unit:Unit){
    if(unit.kind==='templar'&&!unit.revived){
      record('阵亡',label(unit)+'倒下，即将复活。',[unit.id],{action:'death'});
      unit.revived=true;
      unit.field=true;
      unit.hp=maxHealth(unit);
      reviveActor(battle,unit);
      const allies=humanAllies(unit);
      for(const ally of allies)grantBattleStats(ally,1,1);
      buff('复活',unit,allies,'满血复活，使所有友方在场人类获得+1/+1。','+1/+1','empower');
      return false;
    }
    record('阵亡',label(unit)+'阵亡，尸体留在轮盘池中。',[unit.id],{action:'death'});
    if(unit.kind==='axeman')grantHumanArmor(unit,'阵亡');
    return true;
  }

  function castSpells(){
    const board=battle.boards[0];
    for(const [slot,id] of board.entries()){
      const spell=battle.spells.find(candidate=>candidate.id===id);
      if(!spell)continue;
      battle.spellCasts++;
      const name=spells[spell.kind].name,random=battle.runtime.effectRandom;
      const source=spell.id;
      if(spell.kind==='surge'){
        const targets=neighbors(neighborSlots(board,source)).filter(deployed);
        for(const unit of targets)grantPermanentStats(unit,2,2);
        const ids=targets.map(unit=>unit.id);
        const text=targets.length?'使'+targets.length+'名相邻单位永久获得+2/+2。':'没有相邻的在场友方单位。';
        record('法术',name+' · '+text,[source,...ids],{spell:spell.kind,source,value:'+2/+2',valueTargets:ids});
      }else if(spell.kind==='fireball'){
        const targets=battle.units.filter(unit=>unit.side===1&&deployed(unit));
        const target=targets.length?pick(targets,random):undefined;
        if(target){
          target.hp=0;
          target.shield=0;
          fall(target);
          record('法术',name+' · 消灭'+label(target)+'。',[source,target.id],{spell:spell.kind,source,target:target.id,value:'消灭'});
          resolveLethalHit(target);
        }else record('法术',name+' · 没有在场敌方单位。',[source],{spell:spell.kind,source});
      }else{
        const kind=pick(humanKinds,random);
        const count=battle.units.filter(unit=>unit.side===0).length;
        battle.units.push(makeUnit(kind,0,count,RECRUIT_GAIN,RECRUIT_GAIN));
        record('法术',name+' · '+units[kind].name+'加入战队，永久获得+'+RECRUIT_GAIN+'/+'+RECRUIT_GAIN+'。',[source],{spell:spell.kind,source});
      }
      board[slot]=null;
      battle.spells=battle.spells.filter(candidate=>candidate.id!==source);
    }
  }

  function skillCandidates(unit:Unit,slots:(string|null)[]):(string|null)[]{
    if(unit.kind==='lancer')return slots.filter(id=>{
      const neighbor=id&&byId.get(id);
      return id===null||(neighbor&&isCorpse(neighbor));
    });
    const nearby=neighbors(slots);
    switch(unit.kind){
      case 'king': return nearby.filter(isCorpse).map(other=>other.id);
      case 'archer': return nearby.filter(other=>deployed(other)&&other.kind==='guard').map(other=>other.id);
      case 'bone': return nearby.filter(isOrc).map(other=>other.id);
      case 'medic': return nearby.filter(deployed).map(other=>other.id);
      default: return [];
    }
  }

  function skill(unit:Unit,order:WheelSkill){
    const nearby=neighbors(order.neighbors);
    const linked:RecordMoment=(phase,text,focus,details)=>record(phase,label(unit)+text,focus,{
      source:unit.id,originRoll:order.originRoll,...details,
    });
    if(unit.kind==='lancer'){
      if(!order.neighbors.includes(null)&&!nearby.some(other=>other.corpseConsumed))return false;
      grantBattleStats(unit,2,1);
      linked('联动','邻接空位，获得+2/+1。',[unit.id],{action:'empower',value:'+2/+1',valueTargets:[unit.id]});
      return true;
    }
    if(unit.kind==='king'){
      const corpses=nearby.filter(isCorpse);
      if(!corpses.length)return false;
      const gain=2*corpses.length;
      grantPermanentStats(unit,gain,gain);
      for(const corpse of corpses)corpse.corpseConsumed=true;
      linked('联动','吞噬'+corpses.length+'具相邻尸体，永久获得+'+gain+'攻击力和+'+gain+'生命值。',[unit.id,...corpses.map(corpse=>corpse.id)],
        {action:'empower',target:unit.id,value:'+'+gain+'/+'+gain,valueTargets:[unit.id]});
      const board=battle.boards[unit.side];
      for(const corpse of corpses){
        const slot=board.indexOf(corpse.id);
        if(slot!==-1)board[slot]=null;
      }
      return true;
    }
    const living=nearby.filter(deployed);
    if(unit.kind==='medic'){
      const candidates=living.filter(other=>other.hp<maxHealth(other));
      if(!candidates.length)return false;
      const target=pick(candidates,battle.runtime.effectRandom);
      const amount=Math.min(3,maxHealth(target)-target.hp);
      target.hp+=amount;
      linked('联动','为'+units[target.kind].name+'恢复'+amount+'点生命。',[unit.id,target.id],
        {action:'heal',target:target.id,value:'+'+amount,valueTargets:[target.id]});
      return true;
    }
    if(!living.length)return false;
    if(unit.kind==='archer'){
      grantPermanentStats(unit,1,0);
      linked('联动','邻接木盾卫士，永久获得+1攻击力。',[unit.id,...living.map(other=>other.id)],
        {action:'empower',target:unit.id,value:'+1 攻',valueTargets:[unit.id]});
    }else{
      unit.nextAttackBonus=2;
      linked('联动','邻接兽人，下一次普攻伤害+2。',[unit.id,...living.map(other=>other.id)],
        {value:'+2 攻',valueTargets:[unit.id]});
    }
    return true;
  }

  function attack(unit:Unit,target:Unit){
    const damage=currentAttack(unit);
    delete unit.nextAttackBonus;
    const shieldGain=unit.kind==='guard'?2:0;
    unit.shield+=shieldGain;
    const absorbed=Math.min(target.shield,damage);
    target.shield-=absorbed;
    target.hp=Math.max(0,target.hp-damage+absorbed);
    if(target.hp===0)fall(target);
    record('攻击',label(unit)+'攻击'+units[target.kind].name+'，造成'+damage+'点伤害'+(shieldGain?'，自身获得2点护盾。':'。'),
      [unit.id,target.id],{action:'attack',source:unit.id,target:target.id,value:'−'+damage,damage,shieldGain});
    const killed=target.hp===0&&resolveLethalHit(target);
    if(unit.kind==='armoredOrc'){
      const allies=battle.units.filter(other=>other.side===unit.side&&isOrc(other));
      for(const ally of allies)grantBattleStats(ally,1,1);
      buff('攻击',unit,allies,'使所有友方在场兽人获得+1/+1。','+1/+1','empower');
    }
    if(killed&&unit.kind==='orc'){
      unit.orcKills=(unit.orcKills??0)+1;
      if(unit.orcKills>=ORC_EVOLUTION_KILLS){
        const name=label(unit);
        unit.kind='armoredOrc';
        unit.hp+=units.armoredOrc.hp-units.orc.hp;
        delete unit.orcKills;
        record('进化',name+'进化为'+units.armoredOrc.name+'。',[unit.id],
          {source:unit.id,target:unit.id,action:'empower',value:'进化'});
      }
    }
  }

  return {enter,castSpells,skillCandidates,skill,attack};
}
