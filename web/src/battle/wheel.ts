import type {Battle} from '../engine.ts';
import {shuffle} from './random.ts';

export const WHEEL_WIDTH=3;
export const WHEEL_SIZE=WHEEL_WIDTH**2;
export const FIELD_LIMIT=9;
export const LAST_ROLL=100;

export function adjacent(a:number,b:number){
  return a>=0&&b>=0&&a<WHEEL_SIZE&&b<WHEEL_SIZE&&a!==b&&
    Math.max(Math.abs(a%WHEEL_WIDTH-b%WHEEL_WIDTH),Math.abs(Math.floor(a/WHEEL_WIDTH)-Math.floor(b/WHEEL_WIDTH)))===1;
}

export function neighborSlots(board:(string|null)[],id:string){
  const center=board.indexOf(id);
  return board.filter((_,index)=>adjacent(index,center));
}

export function drawBoard(battle:Battle,side:0|1){
  const pool=battle.units.filter(unit=>unit.side===side&&
    (unit.hp>0||!unit.corpseConsumed)).map(unit=>unit.id);
  if(side===0&&battle.spells)pool.push(...battle.spells.map(spell=>spell.id));
  const drawn=shuffle(pool,battle).slice(0,WHEEL_SIZE);
  return shuffle([...drawn,...Array<string|null>(WHEEL_SIZE-drawn.length).fill(null)],battle);
}
