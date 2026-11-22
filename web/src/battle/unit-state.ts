import {hasGuardian,units,type Kind} from '../data.ts';
import type {Side,Unit} from './model.ts';
import {type Actor,type CombatRuntime,profile} from './model.ts';
import {approachMotion,distance} from './movement.ts';
import {pick} from './random.ts';

export type Fighter = {unit:Unit;actor:Actor};

export function deployed(unit:Unit){
  return unit.field&&unit.hp>0;
}

export function chooseTarget(fighter:Fighter,live:Fighter[],clock:CombatRuntime,reachable?:(target:Fighter)=>boolean){
  const enemies=live.filter(other=>other.unit.side!==fighter.unit.side);
  const guards=enemies.filter(other=>hasGuardian(other.unit.kind));
  const preferred=guards.length?guards:enemies;
  const eligible=reachable?preferred.filter(reachable):preferred;
  return eligible.find(other=>other.unit.id===fighter.actor.targetId)??
    (eligible.length?pick(eligible,clock):undefined);
}

export function canAct(actor:Actor){
  return actor.phase==='ready'||actor.phase==='approach';
}

export function turnTowards(actor:Actor,target:Actor){
  if(target.position.x!==actor.position.x)actor.facing=target.position.x>actor.position.x?1:-1;
}

export function withinRange(fighter:Fighter,target:Fighter){
  return distance(fighter.actor.position,target.actor.position)<=profile(fighter.unit.kind).range;
}

export function planMotion(fighter:Fighter,target:Fighter,live:Fighter[]){
  const {actor,unit}=fighter;
  const {speed,range}=profile(unit.kind);
  const obstacles=live.filter(other=>other!==fighter&&other!==target).map(other=>other.actor.position);
  const prefer=(Number(unit.id.split('-')[1])+unit.side)%2===0?1:-1;
  return approachMotion(actor.position,target.actor.position,obstacles,speed,range,prefer);
}

export function recover(actor:Actor,readyAt:number){
  actor.phase='recover';
  actor.readyAt=readyAt;
}

export function currentAttack(unit:Unit){
  return units[unit.kind].atk+unit.bonus+(unit.battleAttackBonus??0);
}

export function maxHealth(unit:Unit){
  return units[unit.kind].hp+unit.healthBonus+(unit.battleHealthBonus??0);
}

export function makeUnit(id:string,kind:Kind,side:Side,bonus=0,healthBonus=0):Unit{
  return {id,kind,side,hp:units[kind].hp+healthBonus,shield:0,bonus,healthBonus,field:false};
}

export function grantBattleStats(unit:Unit,attack:number,health:number){
  if(attack)unit.battleAttackBonus=(unit.battleAttackBonus??0)+attack;
  unit.battleHealthBonus=(unit.battleHealthBonus??0)+health;
  unit.hp+=health;
}

export function grantPermanentStats(unit:Unit,attack:number,health:number){
  unit.bonus+=attack;
  unit.healthBonus+=health;
  unit.hp+=health;
}
