import type {Kind} from '../data.ts';

export type Point = {x:number;y:number};
export type WheelSkill = {sequence:number;originRoll:number;neighbors:(string|null)[]};
export type Actor = {
  position:Point;
  facing:1|-1;
  phase:'ready'|'approach'|'windup'|'recover'|'dead';
  readyAt:number;
  targetId?:string;
  queue:WheelSkill[];
};
export type CombatRuntime = {
  tick:number;
  rng:number;
  effectRandom:{rng:number};
  actors:Record<string,Actor>;
  nextSkill:number;
};

export const COMBAT = {
  width:1000,
  height:640,
  separation:62,
  openingTicks:3,
  ticksPerRoll:6,
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
  return {tick:0,rng:(seed^0xb28e8d6b)>>>0,effectRandom:{rng:(seed^0x92dbf76b)>>>0},actors:{},nextSkill:0};
}
