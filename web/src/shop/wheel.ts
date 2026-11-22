import {pick,shuffle,type RandomState} from '../battle/random.ts';
import {isRegionTag,tagRegions} from '../magic-tags.ts';
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

function symbolPool(roster:UnitInstance[],spells:SpellInstance[]):ShopSlot[]{
  return [
    ...roster.map(unitSlot),
    ...spells.map(({id,kind})=>({type:'spell' as const,id,kind})),
  ];
}

export function drawShopBoard(roster:UnitInstance[],spells:SpellInstance[],random:RandomState){
  const board=shuffle(symbolPool(roster,spells),random).slice(0,WHEEL_SIZE);
  while(board.length<WHEEL_SIZE)board.push(null);
  return shuffle(board,random);
}

export function drawPaidShopBoard(roster:UnitInstance[],spells:SpellInstance[],random:RandomState){
  const candidates=roster.flatMap(unit=>
    isRegionTag(unit.tag)?[{unit,slots:shuffle([...tagRegions[unit.tag]],random)}]:[],
  );
  if(!candidates.length)return {board:drawShopBoard(roster,spells,random),positioned:0};

  type Candidate=typeof candidates[number];
  const matches=new Map<number,Candidate>();
  // Move an existing match within its own region if that frees a legal slot.
  function place(candidate:Candidate,visited:Set<number>):boolean{
    for(const slot of candidate.slots){
      if(visited.has(slot))continue;
      visited.add(slot);
      const previous=matches.get(slot);
      if(!previous||place(previous,visited)){
        matches.set(slot,candidate);
        return true;
      }
    }
    return false;
  }
  for(const candidate of shuffle(candidates,random))place(candidate,new Set());

  const board:ShopSlot[]=Array(WHEEL_SIZE).fill(null);
  const matchedIds=new Set<string>();
  for(const [slot,{unit}] of matches){
    board[slot]=unitSlot(unit);
    matchedIds.add(unit.id);
  }
  const open=shuffle([...board.keys()].filter(slot=>!board[slot]),random);
  const pool=symbolPool(roster.filter(unit=>!matchedIds.has(unit.id)),spells);
  for(const [index,symbol] of shuffle(pool,random).slice(0,open.length).entries())board[open[index]]=symbol;
  return {board,positioned:matches.size};
}
