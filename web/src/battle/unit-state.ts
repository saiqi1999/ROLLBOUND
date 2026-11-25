import {units,type Kind} from '../data.ts';
import type {Side,Unit} from './model.ts';
import {type Actor,type CombatRuntime,profile} from './model.ts';
import {approachMotion,distance,findDetour,followDetour} from './movement.ts';
import {pick} from './random.ts';

export type Fighter = {unit:Unit;actor:Actor};
const STALLED_AFTER_TICKS=2;
const DETOUR_RETRY_TICKS=3;

export function deployed(unit:Unit){
  return unit.field&&unit.hp>0;
}

export function closestEnemy(fighter:Fighter,live:Fighter[],range=Infinity){
  let closest:Fighter|undefined;
  let closestDistance=Infinity;
  for(const other of live){
    if(other.unit.side===fighter.unit.side)continue;
    const gap=distance(fighter.actor.position,other.actor.position);
    if(gap>range||gap>=closestDistance)continue;
    closest=other;
    closestDistance=gap;
  }
  return closest;
}

export function chooseTarget(fighter:Fighter,live:Fighter[],range=Infinity){
  const target=live.find(other=>other.unit.id===fighter.actor.targetId&&other.unit.side!==fighter.unit.side);
  if(target&&withinRange(fighter,target))return target;
  return closestEnemy(fighter,live,range);
}

export const legacyGuardKinds:ReadonlySet<Kind>=new Set(['axeman','templar','armoredOrc','armoredSkeleton']);

export function chooseLegacyTarget(fighter:Fighter,live:Fighter[],clock:CombatRuntime,inRangeOnly=false){
  const enemies=live.filter(other=>other.unit.side!==fighter.unit.side);
  const guards=enemies.filter(other=>legacyGuardKinds.has(other.unit.kind));
  const preferred=guards.length?guards:enemies;
  const eligible=inRangeOnly?preferred.filter(other=>withinRange(fighter,other)):preferred;
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

export function planMotion(fighter:Fighter,target:Fighter,live:Fighter[],tick:number){
  const {actor,unit}=fighter;
  const {speed,range}=profile(unit.kind);
  const from=actor.position,to=target.actor.position;
  if(distance(from,to)<=range)return {x:0,y:0};
  const obstacles=live.filter(other=>other!==fighter&&other!==target).map(other=>other.actor.position);
  const detour=actor.detour;
  const stalled=(actor.blockedTicks??0)>=STALLED_AFTER_TICKS;
  const destination=detour?.waypoints.at(-1);
  if(detour&&destination&&(!stalled||tick<detour.retryAt)&&distance(destination,to)<=range+speed/2){
    const step=followDetour(from,detour.waypoints,[...obstacles,to],speed);
    if(step)return step;
  }
  const prefer=(Number(unit.id.split('-')[1])+unit.side)%2===0?1:-1;
  const direct=approachMotion(from,to,obstacles,speed,range,prefer);
  if((!stalled&&(direct.x||direct.y))||(detour&&tick<detour.retryAt))return direct;
  const blockers=[...obstacles,to];
  const waypoints=findDetour(from,to,blockers,range);
  actor.detour={waypoints,retryAt:tick+DETOUR_RETRY_TICKS};
  return followDetour(from,waypoints,blockers,speed)??direct;
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
