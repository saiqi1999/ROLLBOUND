import {ARMORED_SKELETON_SPAWNS,BONE_ATTACK_GAIN,FEL_SQUIRE_GAIN,GUARD_SHIELD,HUMAN_ARMOR,TEMPLAR_DEATH_GAIN,hasRace,units} from '../data.ts';
import {magicTags,tagIds,teamTagGain} from '../magic-tags.ts';
import {deployUnit,interruptActor} from './combat.ts';
import type {Battle,RecordMoment,Unit} from './model.ts';
import {pick} from './random.ts';
import {currentAttack,deployed,grantBattleStats,grantPermanentStats,makeUnit,maxHealth} from './unit-state.ts';

const label=(unit:Unit)=>(unit.side?'敌方':'我方')+units[unit.kind].name;

function applyDamage(target:Unit,damage:number){
  const rawDamage=Math.max(0,damage);
  const shieldLost=Math.min(target.shield,rawDamage);
  const healthLost=Math.min(target.hp,rawDamage-shieldLost);
  target.shield-=shieldLost;
  target.hp-=healthLost;
  return {rawDamage,shieldLost,healthLost,lethal:target.hp<=0};
}

export function createEffects(battle:Battle,record:RecordMoment){
  const humanAllies=(source:Unit)=>battle.units.filter(other=>
    other.side===source.side&&hasRace(other.kind,'human')&&deployed(other));

  function buff(
    phase:'阵亡'|'攻击',source:Unit,targets:Unit[],description:string,value:string,action?:'empower',
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
      battle.units.push(skeleton);
      deployUnit(battle,skeleton);
      summoned.push(id);
    }
    record('召唤',label(source)+'招来 '+summoned.length+' 名临时骷髅兵。',summoned,{source:source.id});
  }

  function resolveLethalHit(unit:Unit){
    unit.field=false;
    interruptActor(battle,unit);
    if(!unit.temporary)battle.recruitedDeaths[unit.side]++;
    record('阵亡',label(unit)+'阵亡。',[unit.id],{action:'death'});
    if(unit.tag==='team'){
      const amount=teamTagGain(maxHealth(unit));
      if(amount){
        const allies=battle.units.filter(other=>other.side===unit.side&&deployed(other));
        for(const ally of allies)grantBattleStats(ally,amount,amount);
        const gain='+'+amount+'/+'+amount;
        buff('阵亡',unit,allies,'的团队标签使其他在场友方本场 '+gain+'。',gain,'empower');
      }
    }
    if(unit.kind==='axeman'){
      const allies=humanAllies(unit);
      for(const ally of allies)ally.shield+=HUMAN_ARMOR;
      buff('阵亡',unit,allies,'使所有在场友方人类获得 '+HUMAN_ARMOR+' 护甲。','+'+HUMAN_ARMOR+' 甲');
    }
    if(unit.kind==='templar'){
      const allies=humanAllies(unit);
      for(const ally of allies)grantBattleStats(ally,TEMPLAR_DEATH_GAIN,TEMPLAR_DEATH_GAIN);
      const gain='+'+TEMPLAR_DEATH_GAIN+'/+'+TEMPLAR_DEATH_GAIN;
      buff('阵亡',unit,allies,'使其他在场友方人类本场 '+gain+'。',gain,'empower');
    }
    if(unit.kind==='felSquire'){
      const allies=battle.units.filter(other=>other.side===unit.side&&other.hp>0);
      for(const ally of allies)grantBattleStats(ally,FEL_SQUIRE_GAIN,FEL_SQUIRE_GAIN);
      const gain='+'+FEL_SQUIRE_GAIN+'/+'+FEL_SQUIRE_GAIN;
      buff('阵亡',unit,allies,'使存活友方本场 '+gain+'。',gain,'empower');
    }
    if(unit.kind==='felGuard'&&unit.side===0){
      const tag=pick(tagIds,battle.runtime.effectRandom);
      (battle.tagRewards??=[]).push(tag);
      record('阵亡',label(unit)+'使你获得'+magicTags[tag].name+'标签。',[unit.id],{source:unit.id});
    }
    if(hasRace(unit.kind,'undead')){
      const archers=battle.units.filter(other=>other.side===unit.side&&other.kind==='bone'&&deployed(other));
      for(const archer of archers)grantBattleStats(archer,BONE_ATTACK_GAIN,0);
      buff('阵亡',unit,archers,'使在场友方骷髅弓箭手各自获得 +'+BONE_ATTACK_GAIN+' 攻击。','+'+BONE_ATTACK_GAIN+' 攻','empower');
    }
    if(unit.kind==='armoredSkeleton')spawnSummonedUnits(unit);
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

  function attack(unit:Unit,targets:Unit[],followUp?:true){
    const damage=currentAttack(unit);
    const nativeShield=unit.kind==='werebear'?damage:unit.kind==='guard'?GUARD_SHIELD:0;
    const attackId=unit.id+':'+battle.runtime.tick+(followUp?':follow-up':'');
    for(const [index,target] of targets.entries()){
      if(!deployed(target))continue;
      const {rawDamage,shieldLost,healthLost,lethal}=applyDamage(target,damage);
      const tagShield=unit.tag==='shield'?rawDamage:0;
      const healing=unit.tag==='lifesteal'?Math.min(rawDamage,maxHealth(unit)-unit.hp):0;
      const shieldGain=(index===0?nativeShield:0)+tagShield;
      unit.shield+=shieldGain;
      unit.hp+=healing;
      let text=label(unit)+(followUp?'连击':'攻击')+units[target.kind].name+'，造成 '+rawDamage+' 点伤害';
      if(healthLost!==rawDamage)text+='，扣甲 '+shieldLost+'、扣血 '+healthLost;
      if(healing)text+='，吸血 +'+healing;
      if(tagShield)text+='，护盾 +'+shieldGain;
      record('攻击',text+'。',[unit.id,target.id],{
        action:'attack',source:unit.id,target:target.id,attackId,damage:rawDamage,shieldLost,healthLost,shieldGain,healing,followUp,
      });
      if(!lethal)continue;
      resolveLethalHit(target);
      if(unit.kind==='orcRider'){
        if(unit.temporary)grantBattleStats(unit,1,1);
        else grantPermanentStats(unit,1,1);
        buff('攻击',unit,[unit],'击杀敌人，'+(unit.temporary?'本场':'永久')+' +1/+1。','+1/+1','empower');
      }
    }
  }

  return {attack,fireball};
}
