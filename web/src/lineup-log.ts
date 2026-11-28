import type {Run} from './engine.ts';
import {FIELD_LIMIT,type Unit} from './battle/model.ts';
import {currentAttack,maxHealth} from './battle/unit-state.ts';
import {units,type Kind} from './data.ts';
import {magicTags,type AppliedTag} from './magic-tags.ts';

export {BATTLE_RULESET} from './battle/model.ts';
const outcomes={胜利:'win',落败:'loss',平局:'draw'} as const;
const ruleset1Attack:Partial<Record<Kind,number>>={armoredOrc:3,orcRider:3};

export type LineupUnit = {
  id:string;kind:Kind;atk:number;hp:number;armor:number;tag?:AppliedTag;cloneOf?:string;
};
export type Lineup = {starters:LineupUnit[];reserves:LineupUnit[]};
export type LineupRecord = {
  battleId:string;runId:string;round:number;seed:number;ruleset:number;startedAt:number;fireballs:number;
  lineup:Lineup;
  result:null|'win'|'loss'|'draw';ticks:number|null;
};

const unitIdPattern=/^0-\d+(?:-clone)?$/;
const unitFields=new Set(['id','kind','atk','hp','armor','tag','cloneOf']);

function isLineupUnit(value:unknown):value is LineupUnit{
  if(!value||typeof value!=='object')return false;
  const unit=value as Partial<Omit<LineupUnit,'tag'>>&{tag?:unknown};
  return Object.keys(unit).every(key=>unitFields.has(key))&&typeof unit.id==='string'&&unitIdPattern.test(unit.id)&&
    typeof unit.kind==='string'&&Object.hasOwn(units,unit.kind)&&
    [unit.atk,unit.armor].every(stat=>typeof stat==='number'&&Number.isSafeInteger(stat)&&stat>=0)&&
    typeof unit.hp==='number'&&Number.isSafeInteger(unit.hp)&&unit.hp>0&&
    (unit.tag===undefined||(typeof unit.tag==='string'&&unit.tag!=='remove'&&Object.hasOwn(magicTags,unit.tag)))&&
    (unit.cloneOf===undefined||(typeof unit.cloneOf==='string'&&unit.id===unit.cloneOf+'-clone'&&unit.tag===undefined));
}

export function isLineup(value:unknown):value is Lineup{
  if(!value||typeof value!=='object')return false;
  const {starters,reserves}=value as Partial<Lineup>;
  if(!Array.isArray(starters)||!starters.length||starters.length>2*FIELD_LIMIT||!Array.isArray(reserves)||
    !starters.every(isLineupUnit)||!reserves.every(isLineupUnit))return false;
  const roster=[...starters,...reserves];
  return new Set(roster.map(unit=>unit.id)).size===roster.length;
}

function snapshot(unit:Unit,ruleset:number):LineupUnit{
  const oldBase=ruleset===1?ruleset1Attack[unit.kind]:undefined;
  const attack=oldBase===undefined?currentAttack(unit):oldBase+unit.bonus+(unit.battleAttackBonus??0);
  return {
    id:unit.id,kind:unit.kind,atk:attack,hp:maxHealth(unit),armor:unit.shield,
    ...(unit.tag?{tag:unit.tag}:{}),...(unit.cloneOf?{cloneOf:unit.cloneOf}:{}),
  };
}

export function captureLineup(run:Run):LineupRecord|undefined{
  const {battle,lineupRunId}=run;
  if(!battle?.lineupLog||!lineupRunId)return;
  const opening=run.history[0]??battle;
  if(opening.id!==battle.id||opening.runtime.tick!==0||opening.openingResolved)return;

  const allies=opening.units.filter(unit=>unit.side===0);
  const byId=new Map(allies.map(unit=>[unit.id,unit]));
  const outcome=run.results[run.stage];
  const ruleset=battle.lineupLog.ruleset??1;
  return {
    battleId:battle.lineupLog.id,runId:lineupRunId,round:run.stage+1,seed:run.seed,
    ruleset,startedAt:battle.lineupLog.startedAt,fireballs:opening.openingSpells.length,
    lineup:{
      starters:allies.filter(unit=>unit.field).map(unit=>snapshot(unit,ruleset)),
      reserves:opening.reserves[0].map(id=>snapshot(byId.get(id)!,ruleset)),
    },
    result:outcome?outcomes[outcome]:null,
    ticks:outcome?battle.runtime.tick:null,
  };
}
