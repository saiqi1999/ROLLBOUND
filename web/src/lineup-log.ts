import type {Run} from './engine.ts';
import type {Unit} from './battle/model.ts';
import {currentAttack,maxHealth} from './battle/unit-state.ts';
import type {Kind} from './data.ts';
import type {AppliedTag} from './magic-tags.ts';

export const BATTLE_RULESET=3;
const outcomes={胜利:'win',落败:'loss',平局:'draw'} as const;
const ruleset1Attack:Partial<Record<Kind,number>>={armoredOrc:3,orcRider:3};

export type LineupUnit = {
  id:string;kind:Kind;atk:number;hp:number;armor:number;tag?:AppliedTag;cloneOf?:string;
};
export type LineupRecord = {
  battleId:string;runId:string;round:number;seed:number;ruleset:number;startedAt:number;fireballs:number;
  lineup:{starters:LineupUnit[];reserves:LineupUnit[]};
  result:null|'win'|'loss'|'draw';ticks:number|null;
};

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
