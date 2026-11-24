import {
  ARMORED_SKELETON_SPAWNS,BONE_ATTACK_GAIN,FEL_SQUIRE_GAIN,GREATSWORD_COPY_GAIN,HUMAN_ARMOR,NECROMANCER_GAIN,NECROMANCER_GOLD,
  ORC_RIDER_NEIGHBORS,RECRUIT_GAIN,REFRESH_COST,SWORDSMAN_GAIN,TEMPLAR_DEATH_GAIN,WEREWOLF_RECRUIT_GAIN,
  canEvolveOrc,eliteOrcEvolutionGain,hasGuardian,hasRace,humanKinds,
  shopKinds,spellKinds,spellOffer,spells,tagOffer,unitOffer,units,wizardEntryGain,
  type Kind,type Offer,type SpellKind,
} from '../data.ts';
import type {Run} from '../engine.ts';
import {pick,rng,shuffle,type RandomState} from '../battle/random.ts';
import {addTag,magicTags,tagIds} from '../magic-tags.ts';
import {
  grantGrowth,unitStats,wheelFrame,type ShopEvent,type ShopSlot,type ShopState,
  type SpellInstance,type UnitGrowth,type UnitInstance,
} from './model.ts';
import {drawPaidShopBoard,drawShopBoard,neighborSlots,randomOpenSlot,unitSlot} from './wheel.ts';

function shelfRandom(seed:number,stage:number,refreshes:number){
  return {rng:(seed^Math.imul(stage+1,0x9e3779b1)^Math.imul(refreshes+1,0x85ebca6b))>>>0};
}

function previewRandom(seed:number,stage:number,salt=0){
  return {rng:(seed^Math.imul(stage+1,0x343fd)^Math.imul(salt+1,0x65941))>>>0};
}

export function shopOffers(seed:number,stage:number,refreshes=0){
  const random=shelfRandom(seed,stage,refreshes);
  const offers:Offer[]=shuffle([...shopKinds],random).slice(0,3).map(unitOffer);
  offers.push(rng(random)<.5?spellOffer(pick(spellKinds,random)):tagOffer(pick(tagIds,random)));
  return offers;
}

export function createShop(seed:number,stage:number,roster:UnitInstance[]=[]):ShopState{
  return {
    offers:shopOffers(seed,stage),refreshes:0,paidSpins:0,openingSpells:[],
    board:drawShopBoard(roster,[],previewRandom(seed,stage)),lastSpin:null,
  };
}

const nextUnitId=(run:Run)=>'0-'+run.nextId++;

export function recruit(run:Run,kind:Kind,gainedAttack=0,gainedHealth=0){
  const unit:UnitInstance={id:nextUnitId(run),kind,gainedAttack,gainedHealth,startingArmor:0};
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
  if(offer.type==='tag')addTag(run.tagInventory,offer.tag);
  else if(offer.type==='spell')addSpell(run,offer.spell);
  else{
    const wolves=run.roster.filter(unit=>unit.kind==='werewolf');
    const recruits=offer.kinds.map(kind=>recruit(run,kind));
    for(const wolf of wolves)grantGrowth(wolf,{attack:WEREWOLF_RECRUIT_GAIN,health:WEREWOLF_RECRUIT_GAIN});
    const board=run.shop.board;
    const random=previewRandom(run.seed,run.stage,run.nextId);
    for(const unit of recruits){
      const open=randomOpenSlot(board,random);
      if(open===undefined)break;
      board[open]=unitSlot(unit);
    }
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
  return run.roster.splice(index,1)[0];
}

export const spinCost=(paidSpins:number)=>1+Math.floor(paidSpins/2);
export const canSpin=(run:Run)=>run.phase==='shop'&&run.gold>=spinCost(run.shop.paidSpins)&&
  (run.roster.length+run.pendingRecruits.length+run.spells.length)>0;

export function joinPendingRecruits(run:Run){
  const waiting=run.pendingRecruits;
  run.roster.push(...waiting);
  run.pendingRecruits=[];
  return waiting;
}

type Spin = {
  run:Run;
  board:ShopSlot[];
  units:Map<string,UnitInstance>;
  random:RandomState;
  events:ShopEvent[];
  pending:Set<number>;
  examined:Set<string>;
  joined:Set<string>;
  granted:Set<string>;
  priestTriggers:Set<string>;
  evolved:Set<string>;
};
const name=(unit:UnitInstance)=>units[unit.kind].name;
const unique=(ids:string[])=>[...new Set(ids)];
const deathEffectKinds=new Set<Kind>(['armoredSkeleton','axeman','templar','felSquire','felGuard']);
const human=(unit:UnitInstance)=>hasRace(unit.kind,'human');
const orc=(unit:UnitInstance)=>hasRace(unit.kind,'orc');
const felEvolutions:Partial<Record<Kind,Kind>>={orc:'felSquire',armoredOrc:'felGuard'};

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

function writeSpinSlot(spin:Spin,index:number,slot:ShopSlot){
  spin.board[index]=slot;
  spin.pending.add(index);
  for(const nearby of neighborSlots(index))spin.pending.add(nearby);
  // Soldiers check the whole wheel, including recruits placed outside their neighborhood.
  for(const [position,symbol] of spin.board.entries()){
    if(symbol?.type==='unit'&&symbol.kind==='soldier')spin.pending.add(position);
  }
}

function addSpinUnit(spin:Spin,kind:Kind,attack=0,health=0){
  const unit=recruit(spin.run,kind,attack,health);
  spin.units.set(unit.id,unit);
  const open=randomOpenSlot(spin.board,spin.random);
  if(open!==undefined){
    writeSpinSlot(spin,open,unitSlot(unit));
    spin.joined.add(unit.id);
  }
  return unit;
}

function recordEffect(spin:Spin,text:string,focus:string[],buffed:string[]=[]){
  const {run,board}=spin;
  spin.events.push({
    text,focus:unique(focus),...(buffed.length?{buffed:unique(buffed)}:{}),
    after:wheelFrame(board,run.roster),
  });
}

function evolveOrc(run:Run,unit:UnitInstance,next:Kind,spin?:Spin){
  const original=name(unit);
  unit.kind=next;
  const board=spin?.board??run.shop.board;
  const slot=board.findIndex(symbol=>symbol?.id===unit.id);
  if(slot>=0){
    if(spin)writeSpinSlot(spin,slot,unitSlot(unit));
    else board[slot]=unitSlot(unit);
  }
  spin?.evolved.add(unit.id);

  const orcs=run.roster.filter(orc);
  let gain=0;
  for(const elite of orcs.filter(ally=>ally.kind==='eliteOrc')){
    const triggers=elite.evolutionTriggers??0;
    gain+=eliteOrcEvolutionGain(triggers);
    elite.evolutionTriggers=triggers+1;
  }
  if(gain){
    for(const ally of orcs)grantGrowth(ally,{attack:gain,health:gain});
  }
  return {text:original+'永久进化为'+name(unit),gain,buffed:gain?orcs.map(ally=>ally.id):[unit.id]};
}

function grantLinkGrowth(spin:Spin,unit:UnitInstance,ability:Kind,amount:UnitGrowth){
  const key=ability+':'+unit.id;
  if(spin.granted.has(key))return false;
  spin.granted.add(key);
  grantGrowth(unit,amount);
  return true;
}

function resolveSpell(spin:Spin,slot:SpellInstance,index:number){
  const {run,random}=spin;
  const focus=[slot.id];
  const buffed:string[]=[];
  writeSpinSlot(spin,index,null);
  let description:string;
  if(slot.kind==='surge'){
    const targets=onBoard(spin,neighborSlots(index));
    for(const unit of targets){
      grantGrowth(unit,{attack:2,health:2});
      buffed.push(unit.id);
    }
    description=targets.length?'使 '+targets.length+' 名相邻友方永久 +2/+2。':'本次没有相邻友方。';
  }else if(slot.kind==='fireball'){
    run.shop.openingSpells.push({id:slot.id,kind:slot.kind});
    description='已装填。';
  }else{
    const unit=addSpinUnit(spin,pick(humanKinds,random),RECRUIT_GAIN,RECRUIT_GAIN);
    description=name(unit)+'入盘，永久 +'+RECRUIT_GAIN+'/+'+RECRUIT_GAIN+'。';
    buffed.push(unit.id);
  }
  run.spellCasts++;
  run.spells=run.spells.filter(spell=>spell.id!==slot.id);
  recordEffect(spin,spells[slot.kind].name+' · '+description,[...focus,...buffed],buffed);
}

function triggerShopDeath(spin:Spin,source:UnitInstance){
  if(!deathEffectKinds.has(source.kind))return;
  if(source.kind==='felGuard'){
    const tag=pick(tagIds,spin.random);
    addTag(spin.run.tagInventory,tag);
    return {buffed:[],text:'获得'+magicTags[tag].name+'标签'};
  }
  if(source.kind==='felSquire'){
    const allies=spin.run.roster.filter(unit=>unit.id!==source.id);
    for(const unit of allies)grantGrowth(unit,{attack:FEL_SQUIRE_GAIN,health:FEL_SQUIRE_GAIN});
    return {buffed:allies.map(unit=>unit.id),text:'友方全队永久 +'+FEL_SQUIRE_GAIN+'/+'+FEL_SQUIRE_GAIN};
  }
  if(source.kind==='armoredSkeleton'){
    let placed=0;
    for(let count=0;count<ARMORED_SKELETON_SPAWNS;count++){
      if(spin.joined.has(addSpinUnit(spin,'page').id))placed++;
    }
    return {buffed:[],text:ARMORED_SKELETON_SPAWNS+' 名骷髅兵入队，'+placed+' 名入盘'};
  }
  const allies=onBoard(spin).filter(unit=>unit.id!==source.id&&human(unit));
  const armor=source.kind==='axeman';
  const amount=armor?{armor:HUMAN_ARMOR}:{attack:TEMPLAR_DEATH_GAIN,health:TEMPLAR_DEATH_GAIN};
  for(const unit of allies)grantGrowth(unit,amount);
  const text=armor?'其他人类永久 +'+HUMAN_ARMOR+' 初始护甲':
    '其他人类永久 +'+TEMPLAR_DEATH_GAIN+'/+'+TEMPLAR_DEATH_GAIN;
  return {buffed:allies.map(unit=>unit.id),text:allies.length?text:'没有其他人类受益'};
}

function resolvePriest(spin:Spin,source:UnitInstance,neighbors:UnitInstance[],prefix:string){
  const focus=[source.id],buffed:string[]=[],effects:string[]=[];
  for(const target of neighbors){
    const key=source.id+':'+target.id;
    if(spin.priestTriggers.has(key))continue;
    const death=triggerShopDeath(spin,target);
    if(!death)continue;
    spin.priestTriggers.add(key);
    focus.push(target.id);
    buffed.push(...death.buffed);
    effects.push(name(target)+' · '+death.text);
  }
  if(effects.length)recordEffect(spin,prefix+name(source)+' · 触发死亡效果 · '+effects.join('、')+'。',[...focus,...buffed],buffed);
}

function resolveNecromancer(spin:Spin,source:UnitInstance,index:number,prefix:string){
  const {run,board}=spin;
  // Pick this effect's targets before placing any death recruits.
  const targets=neighborSlots(index).filter(position=>{
    const slot=board[position];
    return slot?.type==='unit'&&slot.kind!=='king'&&hasRace(slot.kind,'undead');
  });
  if(!targets.length)return;
  const removed:string[]=[],names:string[]=[],rewards:string[]=[];
  const buffed=[source.id];
  let archerTriggers=0;
  for(const targetIndex of targets){
    const slot=board[targetIndex]!;
    const victim=detachShopUnit(run,slot.id);
    if(!victim)continue;
    spin.units.delete(victim.id);
    writeSpinSlot(spin,targetIndex,null);
    removed.push(victim.id);
    names.push(name(victim));
    grantGrowth(source,{attack:NECROMANCER_GAIN,health:NECROMANCER_GAIN});
    run.gold+=NECROMANCER_GOLD;
    if(victim.kind==='greatswordSkeleton'){
      const copy={...victim,id:nextUnitId(run)};
      grantGrowth(copy,{attack:GREATSWORD_COPY_GAIN,health:GREATSWORD_COPY_GAIN});
      run.pendingRecruits.push(copy);
      rewards.push(name(copy)+'的复制永久 +'+GREATSWORD_COPY_GAIN+'/+'+GREATSWORD_COPY_GAIN+'，下次摇盘或开战前入队');
    }else{
      const death=triggerShopDeath(spin,victim);
      if(death){
        rewards.push(death.text);
        buffed.push(...death.buffed);
      }
    }
    const archers=onBoard(spin).filter(unit=>unit.kind==='bone');
    archerTriggers+=archers.length;
    for(const archer of archers){
      grantGrowth(archer,{attack:BONE_ATTACK_GAIN});
      buffed.push(archer.id);
    }
  }
  if(!removed.length)return;
  const survivingBuffs=buffed.filter(id=>spin.units.has(id));
  const gain=removed.length*NECROMANCER_GAIN;
  const details=[
    '消灭'+names.join('、'),'永久 +'+gain+'/+'+gain,'金币 +'+removed.length*NECROMANCER_GOLD,...rewards,
    ...(archerTriggers?['骷髅弓箭手触发 '+archerTriggers+' 次，各次自身永久 +'+BONE_ATTACK_GAIN+' 攻击']:[]),
  ];
  recordEffect(spin,prefix+name(source)+' · '+details.join(' · ')+'。',[...survivingBuffs,...removed],survivingBuffs);
}

function resolveLink(spin:Spin,source:UnitInstance,index:number,prefix:string){
  const {run,board}=spin;
  const positions=neighborSlots(index);
  const neighbors=onBoard(spin,positions);
  const announce=(text:string,targets:UnitInstance[],buffed:UnitInstance[]=[])=>{
    recordEffect(spin,prefix+name(source)+' · '+text,[source.id,...targets.map(unit=>unit.id)],buffed.map(unit=>unit.id));
  };
  const buff=(amount:UnitGrowth,targets:UnitInstance[],text:string)=>{
    const changed=targets.filter(unit=>grantLinkGrowth(spin,unit,source.kind,amount));
    if(changed.length)announce(text,changed,changed);
  };
  switch(source.kind){
    case 'king':
      resolveNecromancer(spin,source,index,prefix);
      break;
    case 'warlock':{
      const text:string[]=[],buffed:string[]=[];
      let eliteGain=0;
      for(const unit of neighbors){
        const next=felEvolutions[unit.kind];
        if(!next)continue;
        const evolution=evolveOrc(run,unit,next,spin);
        text.push(evolution.text);
        buffed.push(...evolution.buffed);
        eliteGain+=evolution.gain;
      }
      if(eliteGain)text.push('所有友方兽人永久 +'+eliteGain+'/+'+eliteGain);
      if(text.length)recordEffect(spin,prefix+name(source)+' · '+text.join(' · ')+'。',[source.id,...buffed],buffed);
      break;
    }
    case 'archer':{
      const guards=neighbors.filter(unit=>hasGuardian(unit.kind));
      if(!guards.length||!grantLinkGrowth(spin,source,'archer',{attack:1}))break;
      announce('永久 +1 攻击。',guards,[source]);
      break;
    }
    case 'medic':
      resolvePriest(spin,source,neighbors,prefix);
      break;
    case 'soldier':
      buff({health:1},onBoard(spin).filter(unit=>unit.id!==source.id&&human(unit)),'同盘友方人类永久 +1 生命。');
      break;
    case 'swordsman':
      buff({attack:SWORDSMAN_GAIN,health:SWORDSMAN_GAIN},neighbors.filter(human),'相邻友方人类永久 +'+SWORDSMAN_GAIN+'/+'+SWORDSMAN_GAIN+'。');
      break;
    case 'axeman':
      buff({armor:HUMAN_ARMOR},neighbors.filter(human),'相邻友方人类永久 +'+HUMAN_ARMOR+' 初始护甲。');
      break;
    case 'lancer':
      if(positions.some(slot=>!board[slot]))buff({attack:2,health:1},[source],'相邻有空格，永久 +2/+1。');
      break;
    case 'wizard':{
      if(!neighbors.length)break;
      const gain=wizardEntryGain(run.spellCasts);
      for(const unit of neighbors)grantGrowth(unit,{attack:gain,health:gain});
      announce('相邻友方永久 +'+gain+'/+'+gain+'。',neighbors,neighbors);
      break;
    }
  }
}

function resolvePendingLinks(spin:Spin){
  // Only changes to who occupies a slot enqueue more work. Stat grants never refill the queue.
  while(spin.pending.size){
    const index=Math.min(...spin.pending);
    spin.pending.delete(index);
    const slot=spin.board[index];
    const unit=slot?.type==='unit'?spin.units.get(slot.id):undefined;
    if(!unit)continue;
    const chain=spin.examined.has(unit.id)||spin.joined.has(unit.id);
    spin.examined.add(unit.id);
    resolveLink(spin,unit,index,chain?'连锁 · ':'');
  }
}

export function resolveEvolutions(run:Run,spin?:Spin){
  const orcs=run.roster.filter(orc);
  if(!orcs.length)return;
  const onWheel=spin?onBoard(spin).filter(orc):[];
  const wheelIds=new Set(onWheel.map(unit=>unit.id));
  const order=[...onWheel,...orcs.filter(unit=>!wheelIds.has(unit.id))];
  const board=spin?.board??run.shop.board;
  let buffedTeam:boolean;
  do{
    buffedTeam=false;
    for(const unit of order){
      if(spin?.evolved.has(unit.id))continue;
      if(unit.kind!=='orc'&&unit.kind!=='armoredOrc')continue;
      const slot=board.findIndex(symbol=>symbol?.id===unit.id);
      const nearby=spin&&slot>=0&&unit.kind==='armoredOrc'?onBoard(spin,neighborSlots(slot)).filter(orc):[];
      const next=canEvolveOrc(unit.kind,unitStats(unit).attack)?'armoredOrc':
        nearby.length>=ORC_RIDER_NEIGHBORS?'orcRider':undefined;
      if(!next)continue;
      const {text,gain,buffed}=evolveOrc(run,unit,next,spin);
      if(gain)buffedTeam=true;
      if(spin){
        const description=text+'。'+(gain?'所有友方兽人永久 +'+gain+'/+'+gain+'。':'');
        recordEffect(spin,description,[...buffed,...nearby.map(other=>other.id)],buffed);
      }
    }
    // An elite can make an earlier Orc reach its threshold during this pass.
  }while(buffedTeam);
}

export function resolveSpin(run:Run){
  if(!canSpin(run))return;
  run.gold-=spinCost(run.shop.paidSpins);
  const waiting=joinPendingRecruits(run);
  const seed=(run.seed^Math.imul(run.stage+1,0xb4b82e39)^Math.imul(++run.shop.paidSpins,0x7f4a7c15))>>>0;
  const {board,positioned}=drawPaidShopBoard(run.roster,run.spells,{rng:seed});
  const drawn=wheelFrame(board,run.roster);
  const spin:Spin={
    run,board,units:new Map(run.roster.map(unit=>[unit.id,unit])),random:{rng:(seed^0x92dbf76b)>>>0},events:[],
    pending:new Set(board.keys()),examined:new Set(),joined:new Set(),
    granted:new Set(),priestTriggers:new Set(),evolved:new Set(),
  };
  if(waiting.length){
    const visible=waiting.filter(unit=>Object.hasOwn(drawn.stats,unit.id)).map(unit=>unit.id);
    recordEffect(spin,waiting.length+' 名大剑骷髅的复制入队，'+visible.length+' 名入盘。',visible,visible);
  }
  for(const [index,slot] of drawn.board.entries()){
    if(slot?.type==='spell')resolveSpell(spin,slot,index);
  }
  do{
    resolvePendingLinks(spin);
    resolveEvolutions(run,spin);
  }while(spin.pending.size);
  const settled=wheelFrame(board,run.roster);
  const result={
    drawn:drawn.board,drawnStats:drawn.stats,settled:settled.board,settledStats:settled.stats,events:spin.events,
    positioned,fallbackDraws:drawn.board.filter(Boolean).length-positioned,
  };
  run.shop.board=board;
  run.shop.lastSpin=result;
  return result;
}
