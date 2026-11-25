import {COMBAT,profile,type Battle,type Point,type Unit} from './model.ts';
import {distance,resolveMovement} from './movement.ts';
import {shuffle} from './random.ts';
import {
  canAct,chooseLegacyTarget,chooseTarget,closestEnemy,deployed,legacyGuardKinds,
  planMotion,recover,turnTowards,withinRange,type Fighter,
} from './unit-state.ts';

const MOTION_EPSILON=1e-6;
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

export function deployUnit(battle:Battle,unit:Unit){
  unit.field=true;
  spawnActor(battle,unit);
}

function planAttackTargets(battle:Battle,fighter:Fighter,primary:Unit,legacyTargeting:boolean):Unit[]{
  const {unit,actor}=fighter;
  const extra=unit.tag==='triple'?2:unit.tag==='double'?1:0;
  if(!extra)return [primary];
  const range=profile(unit.kind).range;
  const gap=(enemy:Unit)=>distance(actor.position,battle.runtime.actors[enemy.id].position);
  const reachable=battle.units.filter(enemy=>enemy.side!==unit.side&&enemy!==primary&&deployed(enemy)&&gap(enemy)<=range);
  if(legacyTargeting){
    const random=battle.runtime.effectRandom;
    const guards=shuffle(reachable.filter(enemy=>legacyGuardKinds.has(enemy.kind)),random);
    const others=shuffle(reachable.filter(enemy=>!legacyGuardKinds.has(enemy.kind)),random);
    return [primary,...[...guards,...others].slice(0,extra)];
  }
  reachable.sort((left,right)=>gap(left)-gap(right));
  return [primary,...reachable.slice(0,extra)];
}

type CombatEffects = {
  motion:()=>void;
  attack:(attacker:Unit,targets:Unit[],followUp?:true)=>void;
};

export function advanceCombatTick(battle:Battle,effects:CombatEffects){
  // Saved fights that predate ruleset 4 keep their targeting for deterministic replay.
  const legacyTargeting=(battle.ruleset??3)<4;
  const clock=battle.runtime;
  const tick=++clock.tick;
  const fighters=battle.units.filter(deployed).map(unit=>({unit,actor:clock.actors[unit.id]}));
  const byId=new Map(fighters.map(fighter=>[fighter.unit.id,fighter]));
  for(const fighter of fighters){
    const {actor}=fighter;
    if(actor.phase==='recover'&&actor.readyAt<=tick)actor.phase='ready';
    if(actor.phase==='windup'){
      const target=actor.targetId&&byId.get(actor.targetId);
      if(!target||(!legacyTargeting&&!withinRange(fighter,target)))actor.phase='ready';
    }
  }

  const snapshot=fighters.map(({actor})=>actor.position);
  const aim=new Map<Fighter,Fighter>();
  const intents=fighters.map(fighter=>{
    const {actor}=fighter;
    if(!canAct(actor))return {x:0,y:0};
    const target=legacyTargeting?chooseLegacyTarget(fighter,fighters,clock):chooseTarget(fighter,fighters);
    if(actor.targetId!==target?.unit.id){
      actor.detour=undefined;
      actor.blockedTicks=0;
    }
    actor.targetId=target?.unit.id;
    if(!target){actor.phase='ready';return {x:0,y:0};}
    if(legacyTargeting||withinRange(fighter,target))aim.set(fighter,target);
    turnTowards(actor,target.actor);
    actor.phase='approach';
    return planMotion(fighter,target,fighters,tick);
  });
  const moved=resolveMovement(snapshot,intents);
  fighters.forEach(({actor},i)=>{
    actor.position=moved[i];
    if(actor.phase==='approach'){
      actor.blockedTicks=distance(moved[i],snapshot[i])>MOTION_EPSILON?0:(actor.blockedTicks??0)+1;
      const dx=moved[i].x-snapshot[i].x;
      if(actor.detour?.waypoints.length&&Math.abs(dx)>MOTION_EPSILON)actor.facing=dx>0?1:-1;
    }
  });
  if(moved.some((point,i)=>distance(point,snapshot[i])>MOTION_EPSILON))effects.motion();

  for(const fighter of fighters){
    const {unit,actor}=fighter;
    if(actor.phase!=='approach')continue;
    const {range,windup}=profile(unit.kind);
    let target=aim.get(fighter);
    if(target&&!withinRange(fighter,target))target=undefined;
    if(!target&&!legacyTargeting)target=closestEnemy(fighter,fighters,range);
    if(!target)continue;
    actor.targetId=target.unit.id;
    turnTowards(actor,target.actor);
    actor.phase='windup';
    actor.readyAt=tick+windup;
    actor.detour=undefined;
    actor.blockedTicks=0;
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
    effects.attack(unit,planAttackTargets(battle,fighter,target.unit,legacyTargeting));
    if(unit.kind==='orcRider'){
      const live=battle.units.filter(deployed).map(unit=>({unit,actor:clock.actors[unit.id]}));
      const followUp=legacyTargeting?chooseLegacyTarget(fighter,live,clock,true):
        chooseTarget(fighter,live,profile(unit.kind).range);
      if(followUp){
        actor.targetId=followUp.unit.id;
        turnTowards(actor,followUp.actor);
        effects.attack(unit,[followUp.unit],true);
      }
    }
  }
}
