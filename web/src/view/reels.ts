import {spells,units,type Kind} from '../data.ts';
import type {ShopEvent,ShopFrame,ShopSlot,ShopSpinResult,WheelStats} from '../shop/model.ts';
import {WHEEL_WIDTH} from '../shop/wheel.ts';
import {art,heart,spellArt} from './common.ts';

const stopTimes=[600,710,820,930];
const columns=Array.from({length:WHEEL_WIDTH},(_,column)=>
  Array.from({length:WHEEL_WIDTH},(_,row)=>row*WHEEL_WIDTH+column));
const empowerSheet=new Image();
empowerSheet.src=import.meta.env.BASE_URL+'art/fx-empower.png';

const unitLabel=(kind:Kind,stats:WheelStats)=>units[kind].name+'，攻击 '+stats.attack+'，生命 '+stats.health;

function statNumbers(kind:Kind,stats:WheelStats){
  const unit=units[kind];
  return '<span class="wheel-attack'+(stats.attack>unit.atk?' increased':'')+'">⚔ <b>'+stats.attack+'</b></span>'+
    '<span class="wheel-health'+(stats.health>unit.hp?' increased':'')+'">'+heart+' <b>'+stats.health+'</b></span>';
}

function symbol(slot:ShopSlot,stats:ShopFrame['stats'],interactive:boolean){
  if(!slot)return '<span class="cell empty" aria-label="空格"></span>';
  const unit=slot.type==='unit'?units[slot.kind]:undefined;
  const values=unit?(stats[slot.id]??{attack:unit.atk,health:unit.hp}):undefined;
  const content=slot.type==='unit'?art(slot.kind)+'<span class="wheel-stats" aria-hidden="true">'+
    statNumbers(slot.kind,values!)+'</span>':spellArt(slot.kind);
  if(!interactive)return '<span class="cell '+slot.type+'">'+content+'</span>';
  const detail=slot.type==='unit'?' data-kind="'+slot.kind+'" data-unit-id="'+slot.id+'"':' data-spell="'+slot.kind+'"';
  const label=slot.type==='unit'?unitLabel(slot.kind,values!):spells[slot.kind].name;
  return '<button type="button" class="cell '+slot.type+'" data-symbol="'+slot.id+'"'+detail+
    ' aria-label="'+label+'">'+content+'</button>';
}

export function renderReels(host:HTMLElement,frame:ShopFrame){
  host.innerHTML=columns.map(column=>'<div class="reel">'+column.map(index=>
    '<div class="reel-slot">'+symbol(frame.board[index],frame.stats,true)+'</div>').join('')+'</div>').join('');
}

async function waitForAnimations(animations:Animation[],signal:AbortSignal){
  const cancel=()=>{for(const animation of animations)animation.cancel();};
  if(signal.aborted)cancel();
  signal.addEventListener('abort',cancel,{once:true});
  try{await Promise.allSettled(animations.map(animation=>animation.finished));}
  finally{signal.removeEventListener('abort',cancel);}
}

async function playReels(host:HTMLElement,previous:ShopFrame,drawn:ShopFrame,signal:AbortSignal){
  const pool=[...drawn.board,...previous.board].filter((slot):slot is NonNullable<ShopSlot>=>slot!==null);
  const fillerCount=16;
  const tiles=WHEEL_WIDTH*2+fillerCount,travel=100*(tiles-WHEEL_WIDTH)/tiles;
  host.innerHTML=columns.map((column,columnIndex)=>{
    const filler=Array.from({length:fillerCount},(_,i)=>symbol(pool[(i*7+columnIndex*3)%pool.length]??null,drawn.stats,false));
    const cells=[
      ...column.map(index=>symbol(drawn.board[index],drawn.stats,false)),
      ...filler,
      ...column.map(index=>symbol(previous.board[index],previous.stats,false)),
    ];
    return '<div class="reel rolling" aria-hidden="true"><div class="reel-strip" style="--tiles:'+tiles+'">'+
      cells.map(cell=>'<div class="reel-slot">'+cell+'</div>').join('')+'</div></div>';
  }).join('');
  const animations=[...host.querySelectorAll<HTMLElement>('.reel-strip')].map((strip,column)=>strip.animate([
    {transform:'translateY(-'+travel+'%)',offset:0,easing:'cubic-bezier(.42, 0, .72, .65)'},
    {transform:'translateY(-'+(travel*.91)+'%)',offset:.17},
    {transform:'translateY(-'+(travel*.09)+'%)',offset:.79,easing:'cubic-bezier(.14, .38, .32, 1)'},
    {transform:'translateY(0)',offset:1},
  ],{duration:stopTimes[column],fill:'both'}));
  await waitForAnimations(animations,signal);
}

function playBuff(tile:HTMLElement,stats:WheelStats){
  const kind=tile.dataset.kind as Kind;
  const label=tile.querySelector<HTMLElement>('.wheel-stats');
  if(!label||!kind)return [];
  label.innerHTML=statNumbers(kind,stats);
  tile.setAttribute('aria-label',unitLabel(kind,stats));
  const animations=[label.animate([
    {transform:'scale(1)',filter:'brightness(1)'},
    {transform:'scale(1.15)',filter:'brightness(1.35)',offset:.35},
    {transform:'scale(1)',filter:'brightness(1)'},
  ],{duration:270})];
  const frames=empowerSheet.naturalWidth/empowerSheet.naturalHeight;
  if(frames>1){
    const effect=document.createElement('span');
    effect.className='wheel-buff-fx';
    effect.setAttribute('aria-hidden','true');
    effect.style.backgroundImage='url("'+empowerSheet.src+'")';
    effect.style.backgroundSize=(frames*100)+'% 100%';
    tile.append(effect);
    animations.push(effect.animate([{backgroundPositionX:'0%'},{backgroundPositionX:'100%'}],
      {duration:270,easing:'steps('+(frames-1)+',end)',fill:'both'}));
  }
  return animations;
}

async function playLink(host:HTMLElement,before:ShopFrame,event:ShopEvent,signal:AbortSignal){
  const {after}=event;
  const focus=new Set(event.focus),buffed=new Set(event.buffed);
  const nextSlots=new Map(after.board.flatMap(slot=>slot?[[slot.id,slot] as const]:[]));
  const animations:Animation[]=[];
  for(const tile of host.querySelectorAll<HTMLElement>('[data-symbol]')){
    const id=tile.dataset.symbol!;
    if(!focus.has(id)&&!buffed.has(id))continue;
    tile.classList.add('lit');
    const sprite=tile.querySelector<HTMLElement>('img');
    const next=nextSlots.get(id);
    if(sprite)animations.push(sprite.animate([0,.25,.5,.75,1].map(turn=>({
      transform:'translateX(-3px) rotate('+turn+'turn) translateX(3px) rotate('+(-turn)+'turn)',
      opacity:next?1:1-turn,
    })),{duration:270,fill:'both'}));
    if(buffed.has(id)&&next?.type==='unit'&&after.stats[id])animations.push(...playBuff(tile,after.stats[id]));
  }
  await waitForAnimations(animations,signal);
  if(signal.aborted)return;
  for(const animation of animations)animation.cancel();
  renderReels(host,after);

  const previous=new Map(before.board.flatMap(slot=>slot?[[slot.id,slot.kind] as const]:[]));
  const arrivals:Animation[]=[];
  for(const tile of host.querySelectorAll<HTMLElement>('[data-symbol]')){
    const id=tile.dataset.symbol!,next=nextSlots.get(id);
    if(!next||previous.get(id)===next.kind)continue;
    tile.classList.add('lit');
    arrivals.push(tile.animate([
      {transform:'scale(.78)',opacity:.3},{transform:'scale(1)',opacity:1},
    ],{duration:180,easing:'ease-out'}));
    if(!previous.has(id)&&buffed.has(id)&&after.stats[id])arrivals.push(...playBuff(tile,after.stats[id]));
  }
  await waitForAnimations(arrivals,signal);
  for(const animation of arrivals)animation.cancel();
  for(const tile of host.querySelectorAll('.cell.lit'))tile.classList.remove('lit');
  for(const effect of host.querySelectorAll('.wheel-buff-fx'))effect.remove();
}

export async function playShopSpin(
  host:HTMLElement,previous:ShopFrame,result:ShopSpinResult,signal:AbortSignal,onEvent:(event:ShopEvent)=>void,
){
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&typeof host.animate==='function'){
    let frame={board:result.drawn,stats:result.drawnStats};
    await playReels(host,previous,frame,signal);
    if(!signal.aborted)renderReels(host,frame);
    for(const event of result.events){
      if(signal.aborted)break;
      onEvent(event);
      await playLink(host,frame,event,signal);
      frame=event.after;
    }
  }
  renderReels(host,{board:result.settled,stats:result.settledStats});
}
