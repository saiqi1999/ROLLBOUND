import type {Kind} from '../data.ts';
import type {AppliedTag} from '../magic-tags.ts';
import type {OpeningSpell,UnitInstance} from '../shop/model.ts';

export type Point = {x:number;y:number};
export type Side = 0|1;
export type Outcome = '胜利'|'落败'|'平局';
export type Unit = {
  id:string;kind:Kind;side:Side;hp:number;shield:number;bonus:number;healthBonus:number;field:boolean;
  battleAttackBonus?:number;battleHealthBonus?:number;temporary?:true;tag?:AppliedTag;cloneOf?:string;
};

export type Actor = {
  position:Point;
  facing:1|-1;
  phase:'ready'|'approach'|'windup'|'recover'|'dead';
  readyAt:number;
  targetId?:string;
  blockedTicks?:number;
  detour?:{waypoints:Point[];retryAt:number};
};
export type CombatRuntime = {
  tick:number;
  rng:number;
  effectRandom:{rng:number};
  actors:Record<string,Actor>;
};

export type BattlePlan = {
  id:string;
  seed:number;
  allies:UnitInstance[];
  enemies:{kind:Kind;attack:number;health:number}[];
  openingSpells:OpeningSpell[];
};
export type Battle = {
  id:string;
  lineupLog?:{id:string;startedAt:number};
  units:Unit[];
  reserves:[string[],string[]];
  recruitedDeaths:[number,number];
  openingResolved:boolean;
  openingSpells:OpeningSpell[];
  runtime:CombatRuntime;
};

type Phase = '召唤'|'补员'|'法术'|'移动'|'攻击'|'阵亡';
export type Moment = {
  phase:Phase;text:string;focus:string[];tick:number;
  action?:'attack'|'death'|'empower';spell?:'fireball';
  source?:string;target?:string;value?:string;valueTargets?:string[];followUp?:true;
  attackId?:string;damage?:number;shieldLost?:number;healthLost?:number;shieldGain?:number;healing?:number;
};
export type RecordMoment = (
  phase:Phase,text:string,focus?:string[],
  detail?:Omit<Moment,'phase'|'text'|'focus'|'tick'>,
)=>void;
export type CombatTick = {state:Battle;from:number;until:number;opening?:true};
export type BattleWindow = {
  startTick:number;startedAfterOpening:boolean;next:Battle;events:Moment[];ticks:CombatTick[];outcome?:Outcome;
};

export const FIELD_LIMIT=16;
export const DEATHS_PER_REINFORCEMENT=2;
export const COMBAT = {
  width:1000,
  height:640,
  separation:62,
  ticksPerWindow:10,
  maxTicks:1000,
} as const;

const melee={speed:64,range:112,windup:2,recover:7};
const ranged={speed:51,range:374,windup:3,recover:7};
const overrides:Partial<Record<Kind,Partial<typeof melee>>>={
  axeman:{speed:52},
  templar:{speed:56},
  lancer:{range:154},
};

export function profile(kind:Kind){
  const base=kind==='archer'||kind==='bone'||kind==='wizard'||kind==='medic'||kind==='king'?ranged:melee;
  return overrides[kind]?{...base,...overrides[kind]}:base;
}

export function createCombat(seed:number):CombatRuntime{
  return {tick:0,rng:(seed^0xb28e8d6b)>>>0,effectRandom:{rng:(seed^0x92dbf76b)>>>0},actors:{}};
}
