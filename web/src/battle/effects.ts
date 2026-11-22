import {ARMORED_SKELETON_SPAWNS,BONE_ATTACK_GAIN,GUARD_SHIELD,HUMAN_ARMOR,MEDIC_HEAL,units} from '../data.ts';
import {interruptActor,reviveActor,spawnActor} from './combat.ts';
import type {Battle,RecordMoment,Unit} from './model.ts';
import {pick} from './random.ts';
import {currentAttack,deployed,grantBattleStats,grantPermanentStats,makeUnit,maxHealth} from './unit-state.ts';

const label=(unit:Unit)=>(unit.side?'敌方':'我方')+units[unit.kind].name;

export function createEffects(battle:Battle,byId:Map<string,Unit>,record:RecordMoment){
  const humanAllies=(source:Unit)=>battle.units.filter(other=>
    other.side===source.side&&units[other.kind].race==='human'&&deployed(other));

  function buff(
    phase:'复活'|'阵亡'|'攻击',source:Unit,targets:Unit[],description:string,value:string,action?:'empower',
  ){
    if(!targets.length)return;
    const ids=targets.map(unit=>unit.id);
    record(phase,label(source)+description,[...new Set([source.id,...ids])],{
      source:source.id,action,value,valueTargets:ids,
    });
  }

  function spawnSummonedUnits(source:Unit){
    const summoned:string[]=[];
    for(let count=0;count<ARMORED_SKELETON_SPAWNS;count++){
      const id=source.side+'-'+battle.units.length+'-temporary';
      const skeleton=makeUnit(id,'page',source.side);
      skeleton.temporary=true;
      skeleton.field=true;
      battle.units.push(skeleton);
      byId.set(id,skeleton);
      spawnActor(battle,skeleton);
      summoned.push(id);
    }
    record('召唤',label(source)+'招来 '+summoned.length+' 名临时骷髅兵。',summoned,{source:source.id});
  }

  function resolveLethalHit(unit:Unit){
    unit.field=false;
    interruptActor(battle,unit);
    if(unit.kind==='templar'&&!unit.revived){
      unit.revived=true;
      unit.field=true;
      unit.hp=maxHealth(unit);
      reviveActor(battle,unit);
      const allies=humanAllies(unit);
      for(const ally of allies)grantBattleStats(ally,1,1);
      buff('复活',unit,allies,'满血复活，使所有在场友方人类本场 +1/+1。','+1/+1','empower');
      return false;
    }

    if(!unit.temporary)battle.recruitedDeaths[unit.side]++;
    record('阵亡',label(unit)+'阵亡。',[unit.id],{action:'death'});
    if(unit.kind==='axeman'){
      const allies=humanAllies(unit);
      for(const ally of allies)ally.shield+=HUMAN_ARMOR;
      buff('阵亡',unit,allies,'使所有在场友方人类获得 '+HUMAN_ARMOR+' 护甲。','+'+HUMAN_ARMOR+' 甲');
    }
    if(units[unit.kind].race==='undead'){
      const archers=battle.units.filter(other=>other.side===unit.side&&other.kind==='bone'&&deployed(other));
      for(const archer of archers)grantBattleStats(archer,BONE_ATTACK_GAIN,0);
      buff('阵亡',unit,archers,'使在场骷髅弓箭手本场 +'+BONE_ATTACK_GAIN+' 攻击。','+'+BONE_ATTACK_GAIN+' 攻','empower');
    }
    if(unit.kind==='armoredSkeleton')spawnSummonedUnits(unit);
    return true;
  }

  function healPreparedTargets(){
    for(const [medicId,targetId] of Object.entries(battle.medicTargets)){
      const medic=byId.get(medicId),target=byId.get(targetId);
      if(!medic||!target||!deployed(medic)||!deployed(target)||target.hp>maxHealth(target)/2)continue;
      const amount=Math.min(MEDIC_HEAL,maxHealth(target)-target.hp);
      target.hp+=amount;
      delete battle.medicTargets[medicId];
      record('治疗',label(medic)+'为'+units[target.kind].name+'恢复 '+amount+' 生命。',[medicId,targetId],{
        action:'heal',source:medicId,target:targetId,value:'+'+amount,valueTargets:[targetId],
      });
    }
  }

  function fireball(source:string){
    const targets=battle.units.filter(unit=>unit.side===1&&deployed(unit));
    if(!targets.length){
      record('法术','火球术 · 战场上没有可选的敌人。',[],{spell:'fireball',source});
      return;
    }
    const target=pick(targets,battle.runtime.effectRandom);
    target.hp=0;
    target.shield=0;
    record('法术','火球术 · 消灭'+label(target)+'。',[target.id],{
      spell:'fireball',source,target:target.id,value:'消灭',
    });
    resolveLethalHit(target);
  }

  function attack(unit:Unit,target:Unit,followUp?:true){
    const damage=currentAttack(unit);
    const shieldGain=unit.kind==='guard'?GUARD_SHIELD:0;
    unit.shield+=shieldGain;
    const absorbed=Math.min(target.shield,damage);
    target.shield-=absorbed;
    target.hp=Math.max(0,target.hp-damage+absorbed);
    record('攻击',label(unit)+(followUp?'连击':'攻击')+units[target.kind].name+'，造成 '+damage+' 点伤害。',[
      unit.id,target.id,
    ],{action:'attack',source:unit.id,target:target.id,damage,shieldGain,followUp});
    const killed=target.hp===0&&resolveLethalHit(target);
    if(killed&&unit.kind==='orcRider'){
      grantPermanentStats(unit,1,1);
      buff('攻击',unit,[unit],'击杀敌人，永久 +1/+1。','+1/+1','empower');
    }
    healPreparedTargets();
  }

  return {attack,fireball,healPreparedTargets};
}
