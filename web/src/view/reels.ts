import {spells,units} from '../data.ts';
import type {ShopEvent,ShopSlot,ShopSpinResult} from '../shop/model.ts';
import {WHEEL_SIZE,WHEEL_WIDTH} from '../shop/wheel.ts';
import {art,spellArt} from './common.ts';

const stopTimes=[600,710,820,930];
const columns=Array.from({length:WHEEL_WIDTH},(_,column)=>
  Array.from({length:WHEEL_WIDTH},(_,row)=>row*WHEEL_WIDTH+column));
export const emptyBoard=Array<ShopSlot>(WHEEL_SIZE).fill(null);

const symbolName=(slot:NonNullable<ShopSlot>)=>slot.type==='unit'?units[slot.kind].name:spells[slot.kind].name;
const icon=(slot:NonNullable<ShopSlot>)=>slot.type==='unit'?art(slot.kind):spellArt(slot.kind);

function symbol(slot:ShopSlot,interactive:boolean){
  if(!slot)return '<span class="cell empty" aria-label="空格"></span>';
  if(!interactive)return '<span class="cell '+slot.type+'">'+icon(slot)+'</span>';
  const detail=slot.type==='unit'?' data-kind="'+slot.kind+'" data-unit-id="'+slot.id+'"':' data-spell="'+slot.kind+'"';
  return '<button type="button" class="cell '+slot.type+'" data-symbol="'+slot.id+'"'+detail+
    ' aria-label="'+symbolName(slot)+'">'+icon(slot)+'</button>';
}

export function renderReels(host:HTMLElement,board:ShopSlot[]){
  host.innerHTML=columns.map(column=>'<div class="reel">'+column.map(index=>
    '<div class="reel-slot">'+symbol(board[index],true)+'</div>').join('')+'</div>').join('');
}

async function waitForAnimations(animations:Animation[],signal:AbortSignal){
  const cancel=()=>{for(const animation of animations)animation.cancel();};
  if(signal.aborted)cancel();
  signal.addEventListener('abort',cancel,{once:true});
  try{await Promise.allSettled(animations.map(animation=>animation.finished));}
  finally{signal.removeEventListener('abort',cancel);}
}

async function playReels(host:HTMLElement,previous:ShopSlot[],drawn:ShopSlot[],signal:AbortSignal){
  const pool=[...drawn,...previous].filter((slot):slot is NonNullable<ShopSlot>=>slot!==null);
  const fillerCount=16;
  const strips=columns.map((column,index)=>{
    const filler=Array.from({length:fillerCount},(_,i)=>pool[(i*7+index*3)%pool.length]??null);
    return [...column.map(slot=>drawn[slot]),...filler,...column.map(slot=>previous[slot])];
  });
  const tiles=strips[0].length, travel=100*(tiles-WHEEL_WIDTH)/tiles;
  host.innerHTML=strips.map(strip=>'<div class="reel rolling" aria-hidden="true"><div class="reel-strip" style="--tiles:'+
    tiles+'">'+strip.map(slot=>'<div class="reel-slot">'+symbol(slot,false)+'</div>').join('')+'</div></div>').join('');
  const animations=[...host.querySelectorAll<HTMLElement>('.reel-strip')].map((strip,column)=>strip.animate([
    {transform:'translateY(-'+travel+'%)',offset:0,easing:'cubic-bezier(.42, 0, .72, .65)'},
    {transform:'translateY(-'+(travel*.91)+'%)',offset:.17},
    {transform:'translateY(-'+(travel*.09)+'%)',offset:.79,easing:'cubic-bezier(.14, .38, .32, 1)'},
    {transform:'translateY(0)',offset:1},
  ],{duration:stopTimes[column],fill:'both'}));
  await waitForAnimations(animations,signal);
}

async function playLink(host:HTMLElement,event:ShopEvent,signal:AbortSignal){
  const focus=new Set(event.focus),removed=new Set(event.removed);
  const animations:Animation[]=[];
  for(const tile of host.querySelectorAll<HTMLElement>('[data-symbol]')){
    const id=tile.dataset.symbol!;
    if(!focus.has(id))continue;
    tile.classList.add('lit');
    const sprite=tile.querySelector<HTMLElement>('img');
    if(sprite)animations.push(sprite.animate([0,.25,.5,.75,1].map(turn=>({
      transform:'translateX(-3px) rotate('+turn+'turn) translateX(3px) rotate('+(-turn)+'turn)',
      opacity:removed.has(id)?1-turn:1,
    })),{duration:270,fill:'both'}));
  }
  await waitForAnimations(animations,signal);
  for(const animation of animations)animation.cancel();
  for(const tile of host.querySelectorAll<HTMLElement>('[data-symbol]')){
    const id=tile.dataset.symbol!;
    tile.classList.remove('lit');
    if(removed.has(id))tile.outerHTML=symbol(null,false);
    else if(event.evolved?.id===id){
      tile.outerHTML=symbol({type:'unit',...event.evolved},true);
    }
  }
}

export async function playShopSpin(
  host:HTMLElement,previous:ShopSlot[],result:ShopSpinResult,signal:AbortSignal,onEvent:(event:ShopEvent)=>void,
){
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&typeof host.animate==='function'){
    await playReels(host,previous,result.drawn,signal);
    renderReels(host,result.drawn);
    for(const event of result.events){
      if(signal.aborted)break;
      onEvent(event);
      await playLink(host,event,signal);
    }
  }
  renderReels(host,result.settled);
}
