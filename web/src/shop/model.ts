import {units,type Kind,type Offer,type SpellKind} from '../data.ts';
import type {AppliedTag} from '../magic-tags.ts';

export type UnitInstance = {
  id:string;kind:Kind;gainedAttack:number;gainedHealth:number;startingArmor:number;tag?:AppliedTag;
};
export type SpellInstance = {id:string;kind:SpellKind};
export type OpeningSpell = SpellInstance&{kind:'fireball'};
export type ShopSlot =
  | {type:'unit';id:string;kind:Kind}
  | {type:'spell';id:string;kind:SpellKind}
  | null;

export type UnitGrowth = {attack?:number;health?:number;armor?:number};

export type ShopEvent = {
  text:string;
  focus:string[];
  buffed?:string[];
  after:ShopFrame;
};
export type WheelStats = {attack:number;health:number;tag?:AppliedTag};
export type ShopFrame = {board:ShopSlot[];stats:Record<string,WheelStats>};
export type ShopSpinResult = {
  drawn:ShopSlot[];
  drawnStats:ShopFrame['stats'];
  settled:ShopSlot[];
  settledStats:ShopFrame['stats'];
  events:ShopEvent[];
  positioned:number;
  fallbackDraws:number;
};
export type ShopState = {
  offers:Offer[];
  refreshes:number;
  paidSpins:number;
  openingSpells:OpeningSpell[];
  board:ShopSlot[];
  lastSpin:ShopSpinResult|null;
};

export function grantGrowth(unit:UnitInstance,amount:UnitGrowth){
  unit.gainedAttack+=amount.attack??0;
  unit.gainedHealth+=amount.health??0;
  unit.startingArmor+=amount.armor??0;
}

export function unitStats(unit:UnitInstance):WheelStats{
  return {
    attack:units[unit.kind].atk+unit.gainedAttack,
    health:units[unit.kind].hp+unit.gainedHealth,
    ...(unit.tag?{tag:unit.tag}:{}),
  };
}

export function wheelFrame(board:ShopSlot[],roster:UnitInstance[]):ShopFrame{
  const rosterById=new Map(roster.map(unit=>[unit.id,unit]));
  const stats:ShopFrame['stats']={};
  for(const slot of board){
    if(slot?.type!=='unit')continue;
    const unit=rosterById.get(slot.id);
    if(unit)stats[slot.id]=unitStats(unit);
  }
  return {board:board.slice(),stats};
}
