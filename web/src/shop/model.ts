import {units,type Kind,type Offer,type SpellKind} from '../data.ts';

export type UnitInstance = {id:string;kind:Kind;gainedAttack:number;gainedHealth:number};
export type SpellInstance = {id:string;kind:SpellKind};
export type ShopSlot =
  | {type:'unit';id:string;kind:Kind}
  | {type:'spell';id:string;kind:SpellKind}
  | null;

export type PreparedStats = {attack:number;health:number;shield:number};
export type PreparationKind = 'soldier'|'swordsman'|'wizard'|'lancer'|'axeman'|'skeletonArcher';
export type Preparations = {
  buffs:Record<string,Partial<Record<PreparationKind,Partial<PreparedStats>>>>;
  medicTargets:Record<string,string>;
  openingSpells:(SpellInstance&{kind:'fireball'})[];
};

export type ShopEvent = {
  text:string;
  focus:string[];
  buffed?:string[];
  after:ShopFrame;
};
export type WheelStats = Pick<PreparedStats,'attack'|'health'>;
export type ShopFrame = {board:ShopSlot[];stats:Record<string,WheelStats>};
export type ShopSpinResult = {
  drawn:ShopSlot[];
  drawnStats:ShopFrame['stats'];
  settled:ShopSlot[];
  settledStats:ShopFrame['stats'];
  events:ShopEvent[];
};
export type ShopState = {
  offers:Offer[];
  refreshes:number;
  paidSpins:number;
  archersGrown:string[];
  preparations:Preparations;
  board:ShopSlot[];
  lastSpin:ShopSpinResult|null;
};

export function preparedStats(preparations:Preparations,id:string):PreparedStats{
  const stats={attack:0,health:0,shield:0};
  for(const bonus of Object.values(preparations.buffs[id]??{})){
    stats.attack+=bonus.attack??0;
    stats.health+=bonus.health??0;
    stats.shield+=bonus.shield??0;
  }
  return stats;
}

export function unitStats(unit:UnitInstance,preparations?:Preparations):WheelStats{
  const prepared=preparations&&preparedStats(preparations,unit.id);
  return {
    attack:units[unit.kind].atk+unit.gainedAttack+(prepared?.attack??0),
    health:units[unit.kind].hp+unit.gainedHealth+(prepared?.health??0),
  };
}

export function wheelFrame(board:ShopSlot[],roster:UnitInstance[],preparations:Preparations):ShopFrame{
  const rosterById=new Map(roster.map(unit=>[unit.id,unit]));
  const stats:ShopFrame['stats']={};
  for(const slot of board){
    if(slot?.type!=='unit')continue;
    const unit=rosterById.get(slot.id);
    if(unit)stats[slot.id]=unitStats(unit,preparations);
  }
  return {board:board.slice(),stats};
}
