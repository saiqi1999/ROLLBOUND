import {BATTLE_RULESET,FIELD_LIMIT} from './battle/model.ts';
import {encounters} from './data.ts';
import {isLineup,type Lineup} from './lineup-log.ts';

export const mirrorRounds=[4,7] as const;
type MirrorRound=(typeof mirrorRounds)[number];
export type MirrorBundle={ruleset:number;rounds:Partial<Record<MirrorRound,Lineup>>};

export function isMirrorRound(round:number):round is MirrorRound{
  return round===4||round===7;
}

export function isMirrorLineup(value:unknown):value is Lineup{
  return isLineup(value)&&value.starters.length<=FIELD_LIMIT&&
    [...value.starters,...value.reserves].every(unit=>!unit.cloneOf);
}

export function isMirrorBundle(value:unknown):value is MirrorBundle{
  if(!value||typeof value!=='object')return false;
  const {ruleset,rounds}=value as Partial<MirrorBundle>;
  return ruleset===BATTLE_RULESET&&rounds!=null&&typeof rounds==='object'&&!Array.isArray(rounds)&&
    Object.entries(rounds).every(([round,lineup])=>(round==='4'||round==='7')&&isMirrorLineup(lineup));
}

type CurrentOpponent={stage:number;mirrors?:MirrorBundle};

export function mirrorLineup(run:CurrentOpponent,stage=run.stage){
  const round=stage+1;
  return run.mirrors?.ruleset===BATTLE_RULESET&&isMirrorRound(round)?run.mirrors.rounds[round]:undefined;
}

export function opponentName(run:CurrentOpponent,stage=run.stage){
  return encounters[stage].name+(mirrorLineup(run,stage)?' · 影子对手':'');
}
