import {pick,shuffle,type RandomState} from '../battle/random.ts';
import type {ShopSlot,SpellInstance,UnitInstance} from './model.ts';

export const WHEEL_WIDTH=4;
export const WHEEL_SIZE=WHEEL_WIDTH**2;
export const unitSlot=({id,kind}:UnitInstance)=>({type:'unit' as const,id,kind});

export function randomOpenSlot(board:ShopSlot[],random:RandomState){
  const open=[...board.keys()].filter(index=>board[index]===null);
  return open.length?pick(open,random):undefined;
}

export function neighborSlots(index:number){
  const row=Math.floor(index/WHEEL_WIDTH);
  const column=index%WHEEL_WIDTH;
  const neighbors:number[]=[];
  for(let y=Math.max(0,row-1);y<=Math.min(WHEEL_WIDTH-1,row+1);y++){
    for(let x=Math.max(0,column-1);x<=Math.min(WHEEL_WIDTH-1,column+1);x++){
      if(x!==column||y!==row)neighbors.push(y*WHEEL_WIDTH+x);
    }
  }
  return neighbors;
}

export function drawShopBoard(roster:UnitInstance[],spells:SpellInstance[],random:RandomState){
  const pool:ShopSlot[]=[
    ...roster.map(unitSlot),
    ...spells.map(({id,kind})=>({type:'spell' as const,id,kind})),
  ];
  const board=shuffle(pool,random).slice(0,WHEEL_SIZE);
  while(board.length<WHEEL_SIZE)board.push(null);
  return shuffle(board,random);
}
