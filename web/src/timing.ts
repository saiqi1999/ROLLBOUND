export const COMBAT_TICK_MS=145;
export const ATTACK_MS=160;
export const DEATH_MS=320;
export const EFFECT_MS=400;
export const WHEEL_MOTION={draw:160,cast:260,orbit:360,shake:240} as const;
export type WheelMotion = keyof typeof WHEEL_MOTION;
