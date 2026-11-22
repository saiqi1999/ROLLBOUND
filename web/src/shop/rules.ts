import {
  ARMORED_SKELETON_SPAWNS,BONE_ATTACK_GAIN,HUMAN_ARMOR,NECROMANCER_GAIN,NECROMANCER_LIMIT,
  ORC_RIDER_NEIGHBORS,RECRUIT_GAIN,REFRESH_COST,SKELETON_GOLD,canEvolveOrc,humanKinds,
  spellKinds,spellOffer,spells,unitKinds,unitOffer,units,wizardEntryGain,
  type Kind,type SpellKind,
} from '../data.ts';
import type {Run} from '../engine.ts';
import {pick,shuffle,type RandomState} from '../battle/random.ts';
import {
  preparedStats,type PreparationKind,type PreparedStats,type ShopEvent,type ShopSlot,type ShopState,
  type SpellInstance,type UnitInstance,
} from './model.ts';
import {drawShopBoard,neighborSlots} from './wheel.ts';

function shelfRandom(seed:number,stage:number,refreshes:number){
  return {rng:(seed^Math.imul(stage+1,0x9e3779b1)^Math.imul(refreshes+1,0x85ebca6b))>>>0};
}

export function shopOffers(seed:number,stage:number,refreshes=0){
  const random=shelfRandom(seed,stage,refreshes);
  const offers=shuffle([...unitKinds],random).slice(0,3).map(unitOffer);
  offers.push(spellOffer(pick(spellKinds,random)));
  return offers;
}

export function createShop(seed:number,stage:number):ShopState{
  return {
    offers:shopOffers(seed,stage),refreshes:0,paidSpins:0,archersGrown:[],
    preparations:{buffs:{},medicTargets:{},openingSpells:[]},lastSpin:null,
  };
}

export function recruit(run:Run,kind:Kind,gainedAttack=0,gainedHealth=0){
  const unit={id:'0-'+run.nextId++,kind,gainedAttack,gainedHealth};
  run.roster.push(unit);
  return unit;
}

function addSpell(run:Run,kind:SpellKind){
  const spell={id:'spell-'+run.nextId++,kind};
  run.spells.push(spell);
  return spell;
}

export function buy(run:Run,index:number){
  const offer=run.shop.offers[index];
  if(run.phase!=='shop'||!offer||offer.sold||run.gold<offer.price)return false;
  run.gold-=offer.price;
  offer.sold=true;
  if(offer.spell)addSpell(run,offer.spell);
  else{
    for(const kind of offer.kinds)recruit(run,kind);
    if(offer.kinds[0]==='bat'){
      const random=shelfRandom(run.seed,run.stage,run.shop.refreshes);
      random.rng=(random.rng^Math.imul(index+1,0xc2b2ae35))>>>0;
      addSpell(run,pick(spellKinds,random));
    }
  }
  return true;
}

export function refreshShop(run:Run){
  if(run.phase!=='shop'||run.gold<REFRESH_COST)return false;
  run.gold-=REFRESH_COST;
  run.shop.offers=shopOffers(run.seed,run.stage,++run.shop.refreshes);
  return true;
}

export function detachShopUnit(run:Run,id:string){
  const index=run.roster.findIndex(unit=>unit.id===id);
  if(index<0)return;
  const [unit]=run.roster.splice(index,1);
  const {buffs,medicTargets}=run.shop.preparations;
  delete buffs[id];
  delete medicTargets[id];
  for(const [medic,target] of Object.entries(medicTargets)){
    if(target===id)delete medicTargets[medic];
  }
  const grown=run.shop.archersGrown.indexOf(id);
  if(grown!==-1)run.shop.archersGrown.splice(grown,1);
  return unit;
}

export const spinCost=(paidSpins:number)=>1+Math.floor(paidSpins/2);
export const canSpin=(run:Run)=>run.phase==='shop'&&run.gold>=spinCost(run.shop.paidSpins)&&
  (run.roster.length+run.spells.length)>0;

type Spin = {
  run:Run;
  board:ShopSlot[];
  units:Map<string,UnitInstance>;
  random:RandomState;
  events:ShopEvent[];
};
const name=(unit:UnitInstance)=>units[unit.kind].name;
const unique=(ids:string[])=>[...new Set(ids)];
const shopDeathKinds=new Set<Kind>(['page','armoredSkeleton','bone']);

function onBoard(spin:Spin,positions:Iterable<number>=spin.board.keys()){
  const found:UnitInstance[]=[];
  for(const index of positions){
    const slot=spin.board[index];
    if(slot?.type!=='unit')continue;
    const unit=spin.units.get(slot.id);
    if(unit)found.push(unit);
  }
  return found;
}

function prepareBuff(run:Run,unit:UnitInstance,key:PreparationKind,amount:Partial<PreparedStats>){
  const buffs=(run.shop.preparations.buffs[unit.id]??={});
  const previous=buffs[key];
  const next={
    attack:Math.max(previous?.attack??0,amount.attack??0),
    health:Math.max(previous?.health??0,amount.health??0),
    shield:Math.max(previous?.shield??0,amount.shield??0),
  };
  if(previous?.attack===next.attack&&previous.health===next.health&&previous.shield===next.shield)return false;
  buffs[key]=next;
  return true;
}

function resolveSpell(spin:Spin,slot:SpellInstance,index:number){
  const {run,random,events,board}=spin;
  const focus=[slot.id];
  let description:string;
  if(slot.kind==='surge'){
    const targets=onBoard(spin,neighborSlots(index));
    for(const unit of targets){unit.gainedAttack+=2;unit.gainedHealth+=2;focus.push(unit.id);}
    description=targets.length?'使 '+targets.length+' 名相邻友方永久 +2/+2。':'本次没有相邻友方。';
  }else if(slot.kind==='fireball'){
    run.shop.preparations.openingSpells.push({id:slot.id,kind:slot.kind});
    description='已装填到下一战。';
  }else{
    const unit=recruit(run,pick(humanKinds,random),RECRUIT_GAIN,RECRUIT_GAIN);
    description=name(unit)+'入队，永久 +'+RECRUIT_GAIN+'/+'+RECRUIT_GAIN+'。';
  }
  run.spellCasts++;
  run.spells=run.spells.filter(spell=>spell.id!==slot.id);
  board[index]=null;
  events.push({text:spells[slot.kind].name+' · '+description,focus,removed:[slot.id]});
}

function resolveNecromancer(spin:Spin,source:UnitInstance,index:number){
  const {run,board,events}=spin;
  const removed:string[]=[],names:string[]=[],focus=[source.id];
  let gold=0,joined=0,archerBuff=false;
  for(const targetIndex of neighborSlots(index)){
    const slot=board[targetIndex];
    if(slot?.type!=='unit'||!shopDeathKinds.has(slot.kind))continue;
    const victim=detachShopUnit(run,slot.id);
    if(!victim)continue;
    board[targetIndex]=null;
    removed.push(victim.id);
    names.push(name(victim));
    source.gainedAttack+=NECROMANCER_GAIN;
    source.gainedHealth+=NECROMANCER_GAIN;
    if(victim.kind==='page'){
      gold+=SKELETON_GOLD;
      run.gold+=SKELETON_GOLD;
    }else if(victim.kind==='armoredSkeleton'){
      for(let count=0;count<ARMORED_SKELETON_SPAWNS;count++)recruit(run,'page');
      joined+=ARMORED_SKELETON_SPAWNS;
    }else{
      prepareBuff(run,source,'skeletonArcher',{attack:BONE_ATTACK_GAIN});
      archerBuff=true;
    }
    for(const archer of onBoard(spin).filter(unit=>unit.kind==='bone')){
      if(prepareBuff(run,archer,'skeletonArcher',{attack:BONE_ATTACK_GAIN}))focus.push(archer.id);
    }
    if(removed.length===NECROMANCER_LIMIT)break;
  }
  if(!removed.length)return;
  const gain=removed.length*NECROMANCER_GAIN;
  const details=[
    '消灭'+names.join('、'),'永久 +'+gain+'/+'+gain,
    ...(gold?['金币 +'+gold]:[]),...(joined?[joined+' 名骷髅兵入队']:[]),
    ...(archerBuff?['亡灵法师下战 +'+BONE_ATTACK_GAIN+' 攻击']:[]),
    ...(focus.some(id=>id!==source.id&&!removed.includes(id))?['在盘骷髅弓箭手下战 +'+BONE_ATTACK_GAIN+' 攻击']:[]),
  ];
  events.push({text:name(source)+' · '+details.join(' · ')+'。',focus:unique([...focus,...removed]),removed});
}

function resolveLink(spin:Spin,source:UnitInstance,index:number){
  const {run,board,events,random}=spin;
  const positions=neighborSlots(index);
  const neighbors=onBoard(spin,positions);
  const human=(unit:UnitInstance)=>units[unit.kind].race==='human';
  const announce=(text:string,targets:UnitInstance[])=>{
    events.push({text:name(source)+' · '+text,focus:unique([source.id,...targets.map(unit=>unit.id)])});
  };
  const buff=(key:PreparationKind,amount:Partial<PreparedStats>,targets:UnitInstance[],text:string)=>{
    // The strongest preparation from each ability is kept for each unit.
    const changed=targets.filter(unit=>prepareBuff(run,unit,key,amount));
    if(changed.length)announce(text,changed);
  };
  switch(source.kind){
    case 'king':
      resolveNecromancer(spin,source,index);
      break;
    case 'archer':{
      const guards=neighbors.filter(unit=>unit.kind==='guard');
      if(!guards.length||run.shop.archersGrown.includes(source.id))break;
      source.gainedAttack++;
      run.shop.archersGrown.push(source.id);
      announce('永久 +1 攻击。',guards);
      break;
    }
    case 'medic':{
      if(!neighbors.length)break;
      const target=pick(neighbors,random);
      run.shop.preparations.medicTargets[source.id]=target.id;
      announce('已为'+name(target)+'备好下战治疗。',[target]);
      break;
    }
    case 'soldier':
      buff('soldier',{health:1},onBoard(spin).filter(unit=>unit.id!==source.id&&human(unit)),'同盘友方人类下战 +1 生命。');
      break;
    case 'swordsman':
      buff('swordsman',{attack:2,health:2},neighbors.filter(human),'相邻友方人类下战 +2/+2。');
      break;
    case 'axeman':
      buff('axeman',{shield:HUMAN_ARMOR},neighbors.filter(human),'相邻友方人类下战获得 '+HUMAN_ARMOR+' 护甲。');
      break;
    case 'lancer':
      if(positions.some(slot=>!board[slot]))buff('lancer',{attack:2,health:1},[source],'相邻有空格，下战 +2/+1。');
      break;
    case 'wizard':{
      const gain=wizardEntryGain(run.spellCasts);
      buff('wizard',{attack:gain,health:gain},neighbors,'相邻友方下战 +'+gain+'/+'+gain+'。');
      break;
    }
  }
}

export function resolveEvolutions(run:Run,spin?:Spin){
  const onWheel=spin?onBoard(spin):[];
  const wheelIds=new Set(onWheel.map(unit=>unit.id));
  const order=[...onWheel,...run.roster.filter(unit=>!wheelIds.has(unit.id))];
  for(const unit of order){
    const attack=units[unit.kind].atk+unit.gainedAttack+preparedStats(run.shop.preparations,unit.id).attack;
    const slot=spin?.board.findIndex(symbol=>symbol?.id===unit.id)??-1;
    const nearby=spin&&slot>=0?onBoard(spin,neighborSlots(slot)).filter(other=>units[other.kind].race==='orc'):[];
    const next=canEvolveOrc(unit.kind,attack)?'armoredOrc':
      unit.kind==='armoredOrc'&&nearby.length>=ORC_RIDER_NEIGHBORS?'orcRider':undefined;
    if(!next)continue;
    const text=name(unit)+'永久进化为'+units[next].name+'。';
    unit.kind=next;
    if(spin&&slot>=0)spin.board[slot]={type:'unit',id:unit.id,kind:next};
    spin?.events.push({text,focus:[unit.id,...nearby.map(other=>other.id)],evolved:{id:unit.id,kind:next}});
  }
}

export function resolveSpin(run:Run){
  if(!canSpin(run))return;
  run.gold-=spinCost(run.shop.paidSpins);
  const seed=(run.seed^Math.imul(run.stage+1,0xb4b82e39)^Math.imul(++run.shop.paidSpins,0x7f4a7c15))>>>0;
  const board=drawShopBoard(run.roster,run.spells,{rng:seed});
  const drawn=board.slice();
  const spin:Spin={run,board,units:new Map(run.roster.map(unit=>[unit.id,unit])),random:{rng:(seed^0x92dbf76b)>>>0},events:[]};
  for(const [index,slot] of board.entries()){
    if(slot?.type==='spell')resolveSpell(spin,slot,index);
  }
  for(const [index,slot] of board.entries()){
    if(slot?.type!=='unit')continue;
    const unit=spin.units.get(slot.id);
    if(unit)resolveLink(spin,unit,index);
  }
  resolveEvolutions(run,spin);
  const result={drawn,settled:board,events:spin.events};
  run.shop.lastSpin=result;
  return result;
}
