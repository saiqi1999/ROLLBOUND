import {COMBAT,profile,type Battle,type Point,type Unit} from './model.ts';
import {distance,resolveMovement} from './movement.ts';
import {canAct,chooseTarget,deployed,planMotion,recover,turnTowards,withinRange,type Fighter} from './unit-state.ts';

const homeSlots:Point[]=[
  {x:204,y:307},{x:251,y:429},{x:255,y:179},
  {x:132,y:390},{x:143,y:230},{x:199,y:517},
  {x:195,y:108},{x:88,y:499},{x:92,y:127},
  {x:321,y:243},{x:314,y:373},{x:319,y:497},
  {x:320,y:112},{x:107,y:578},{x:247,y:583},{x:111,y:58},
];

export function spawnActor(battle:Battle,unit:Unit){
  const clock=battle.runtime;
  const occupied=Object.values(clock.actors).filter(actor=>actor.phase!=='dead').map(actor=>actor.position);
  const free=(point:Point)=>occupied.every(other=>distance(point,other)>=COMBAT.separation);
  const positions=homeSlots.map(({x,y})=>({x:unit.side?COMBAT.width-x:x,y}));
  let position=positions.find(free);
  if(!position){
    let widest=0;
    position=positions[0];
    // Even if the home side is crowded, summons are placed in the widest gap.
    for(let x=COMBAT.separation;x<COMBAT.width/2;x+=COMBAT.separation){
      for(let y=COMBAT.separation;y<COMBAT.height;y+=COMBAT.separation){
        const candidate={x:unit.side?COMBAT.width-x:x,y};
        const clearance=occupied.reduce((nearest,other)=>Math.min(nearest,distance(candidate,other)),Infinity);
        if(clearance>widest){widest=clearance;position=candidate;}
      }
    }
  }
  clock.actors[unit.id]={position,facing:unit.side?-1:1,phase:'ready',readyAt:clock.tick};
}

export function interruptActor(battle:Battle,unit:Unit){
  const clock=battle.runtime, actor=clock?.actors[unit.id];
  if(!actor||!clock)return;
  actor.targetId=undefined;
  actor.phase='dead';
}

type CombatEffects = {
  motion:()=>void;
  attack:(attacker:Unit,target:Unit,followUp?:true)=>void;
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

  const snapshot=fighters.map(({actor})=>actor.position);
  const aim=new Map<Fighter,Fighter>();
  const intents=fighters.map(fighter=>{
    const {actor}=fighter;
    if(!canAct(actor))return {x:0,y:0};
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
    // Earlier hits can kill a later attacker before its attack resolves.
    if(actor.phase!=='windup'||!deployed(unit))continue;
    const target=actor.targetId&&byId.get(actor.targetId);
    if(!target||!deployed(target.unit)||!withinRange(fighter,target)){
      actor.phase='ready';
      continue;
    }
    turnTowards(actor,target.actor);
    recover(actor,tick+profile(unit.kind).recover);
    effects.attack(unit,target.unit);
    if(unit.kind==='orcRider'){
      const live=battle.units.filter(deployed).map(unit=>({unit,actor:clock.actors[unit.id]}));
      const followUp=chooseTarget(fighter,live,clock,enemy=>withinRange(fighter,enemy));
      if(followUp){
        actor.targetId=followUp.unit.id;
        turnTowards(actor,followUp.actor);
        effects.attack(unit,followUp.unit,true);
      }
    }
  }
}
