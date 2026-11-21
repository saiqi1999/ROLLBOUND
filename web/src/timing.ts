import type {Moment} from './engine.ts';

export const ATTACK_MS=160;
export const MOVE_MS=145;
export const EFFECT_MS=400;
export const WHEEL_MOTION={orbit:360,shake:240} as const;

export function momentDuration(moment:Moment|undefined){
  switch(moment?.phase){
    case '攻击': return ATTACK_MS;
    case '移动': return MOVE_MS;
    case '停盘': return 380;
    default: return 520;
  }
}
