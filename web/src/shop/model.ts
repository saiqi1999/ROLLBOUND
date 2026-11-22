import type {Kind,Offer,SpellKind} from '../data.ts';

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
  removed?:string[];
  evolved?:{id:string;kind:Kind};
};
export type ShopSpinResult = {drawn:ShopSlot[];settled:ShopSlot[];events:ShopEvent[]};
export type ShopState = {
  offers:Offer[];
  refreshes:number;
  paidSpins:number;
  archersGrown:string[];
  preparations:Preparations;
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
