import type {Battle,Unit} from '../engine.ts';
import {COMBAT,profile,type Point,type WheelSkill} from './model.ts';
import {distance,resolveMovement} from './movement.ts';
import {canAct,chooseTarget,deployed,planMotion,recover,turnTowards,withinRange,type Fighter} from './unit-state.ts';

const homeSlots:Point[]=[
  {x:204,y:307},{x:251,y:429},{x:255,y:179},
  {x:132,y:390},{x:143,y:230},{x:199,y:517},
  {x:195,y:108},{x:88,y:499},{x:92,y:127},
];

export function spawnActor(battle:Battle,unit:Unit){
  const clock=battle.runtime;
  const occupied=Object.values(clock.actors).filter(actor=>actor.phase!=='dead').map(actor=>actor.position);
  const free=(point:Point)=>occupied.every(other=>distance(point,other)>=COMBAT.separation);
  const positions=homeSlots.map(({x,y})=>({x:unit.side?COMBAT.width-x:x,y}));
  let position=positions.find(free);
  // A moving fighter can occupy a spawn position. The arena has room for fallback
  // positions even when both sides deploy their full nine units at once.
  for(let x=COMBAT.separation;!position&&x<COMBAT.width;x+=COMBAT.separation){
    for(let y=COMBAT.separation;!position&&y<COMBAT.height;y+=COMBAT.separation){
      const candidate={x:unit.side?COMBAT.width-x:x,y};
      if(free(candidate))position=candidate;
    }
  }
  if(!position)throw new Error('No room to deploy '+unit.id);
  clock.actors[unit.id]={position,facing:unit.side?-1:1,phase:'ready',readyAt:clock.tick,queue:[]};
}

export function interruptActor(battle:Battle,unit:Unit){
  const clock=battle.runtime, actor=clock?.actors[unit.id];
  if(!actor||!clock)return;
  actor.queue=[];
  actor.targetId=undefined;
  actor.phase='dead';
  delete unit.nextAttackBonus;
}

export function reviveActor(battle:Battle,unit:Unit){
  const clock=battle.runtime, actor=clock?.actors[unit.id];
  if(actor&&clock)recover(actor,clock.tick+1);
}

export function queueSkill(battle:Battle,unit:Unit,neighbors:(string|null)[]){
  const clock=battle.runtime;
  clock.actors[unit.id].queue.push({sequence:clock.nextSkill++,originRoll:battle.round,neighbors});
}

type CombatEffects = {
  skill:(unit:Unit,order:WheelSkill)=>boolean;
  motion:()=>void;
  attack:(attacker:Unit,target:Unit)=>void;
};

export function advanceCombatTick(battle:Battle,effects:CombatEffects){
  const clock=battle.runtime;
  const tick=++clock.tick;
  const fighters=battle.units.filter(deployed).map(unit=>({unit,actor:clock.actors[unit.id]}));
  const byId=new Map(fighters.map(fighter=>[fighter.unit.id,fighter]));
  for(const {actor} of fighters){
    if(actor.phase==='recover'&&actor.readyAt<=tick)actor.phase='ready';
    if(actor.phase==='windup'&&(!actor.targetId||!byId.has(actor.targetId)))actor.phase='ready';
  }

  // Resolve the head of the shared wheel order at its own unit's safe action point.
  const queued=fighters.filter(({actor})=>actor.queue.length);
  while(queued.length){
    queued.sort((a,b)=>a.actor.queue[0].sequence-b.actor.queue[0].sequence);
    const {unit,actor}=queued[0];
    if(!canAct(actor))break;
    const order=actor.queue.shift()!;
    if(effects.skill(unit,order))recover(actor,tick+1);
    if(!actor.queue.length)queued.shift();
  }

  const snapshot=fighters.map(({actor})=>actor.position);
  const aim=new Map<Fighter,Fighter>();
  const intents=fighters.map(fighter=>{
    const {actor}=fighter;
    if(!canAct(actor)||actor.queue.length)return {x:0,y:0};
    const target=chooseTarget(fighter,fighters,clock);
    actor.targetId=target?.unit.id;
    if(!target){actor.phase='ready';return {x:0,y:0};}
    aim.set(fighter,target);
    turnTowards(actor,target.actor);
    actor.phase='approach';
    return planMotion(fighter,target,fighters);
  });
  const moved=resolveMovement(snapshot,intents);
  fighters.forEach(({actor},i)=>{actor.position=moved[i];});
  if(moved.some((point,i)=>distance(point,snapshot[i])>1e-6))effects.motion();

  for(const [fighter,target] of aim){
    if(!withinRange(fighter,target))continue;
    fighter.actor.phase='windup';
    fighter.actor.readyAt=tick+profile(fighter.unit.kind).windup;
  }

  const firstSide=tick%2;
  const hits=fighters.filter(({actor})=>actor.phase==='windup'&&actor.readyAt<=tick)
    .sort((a,b)=>Number(a.unit.side!==firstSide)-Number(b.unit.side!==firstSide));
  for(const fighter of hits){
    const {unit,actor}=fighter;
    // Earlier hits can kill a later attacker, or interrupt it when a Templar revives.
    if(actor.phase!=='windup'||!deployed(unit))continue;
    const target=actor.targetId&&byId.get(actor.targetId);
    if(!target||!deployed(target.unit)||!withinRange(fighter,target)){
      actor.phase='ready';
      continue;
    }
    turnTowards(actor,target.actor);
    recover(actor,tick+profile(unit.kind).recover);
    effects.attack(unit,target.unit);
  }
}
