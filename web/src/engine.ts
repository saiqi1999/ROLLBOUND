import {encounters,SLIME_REMOVAL_GAIN} from './data.ts';
import {createBattle} from './battle/resolve.ts';
import type {Battle,BattleWindow,Outcome} from './battle/model.ts';
import type {ShopState,SpellInstance,UnitInstance} from './shop/model.ts';
import {createShop,detachShopUnit,resolveEvolutions} from './shop/rules.ts';
import {COMBAT_TICK_MS} from './timing.ts';

export type {Battle,Moment,Outcome,Unit} from './battle/model.ts';
export {currentAttack,maxHealth} from './battle/unit-state.ts';
export {simulateBattleWindow} from './battle/resolve.ts';

export type Run = {
  version:4;seed:number;stage:number;gold:number;nextId:number;
  roster:UnitInstance[];spells:SpellInstance[];spellCasts:number;shop:ShopState;removalsUsed:number;
  phase:'shop'|'battle'|'result'|'end';battle:Battle|null;
  results:Outcome[];log:string[];history:Battle[];
};

export function newRun(seed:number):Run{
  return {
    version:4,seed,stage:0,gold:encounters[0].gold,nextId:0,roster:[],spells:[],spellCasts:0,
    shop:createShop(seed,0),removalsUsed:0,phase:'shop',battle:null,results:[],log:[],history:[],
  };
}

export function canStartBattle(run:Run){
  return run.phase==='shop'&&run.roster.length>0;
}

export function earnedRemovalMarker(stage:number,result:Outcome|undefined){
  return (stage+1)%2===0&&result==='胜利';
}

export function removalMarkers(run:Run){
  const earned=run.results.filter((result,stage)=>earnedRemovalMarker(stage,result)).length;
  return Math.max(0,earned-run.removalsUsed);
}

export function removeUnit(run:Run,id:string){
  if(run.phase!=='shop'||!removalMarkers(run))return false;
  const removed=detachShopUnit(run,id);
  if(!removed)return false;
  run.removalsUsed++;
  if(removed.kind==='slime'){
    for(const unit of run.roster){
      unit.gainedAttack+=SLIME_REMOVAL_GAIN;
      unit.gainedHealth+=SLIME_REMOVAL_GAIN;
    }
    resolveEvolutions(run);
  }
  return true;
}

export function startBattle(run:Run){
  if(!canStartBattle(run))return false;
  const encounter=encounters[run.stage];
  const seed=(run.seed^Math.imul(run.stage+1,2654435761))>>>0;
  run.battle=createBattle({
    id:run.seed+':'+run.stage,seed,allies:run.roster,
    enemies:encounter.units.map(kind=>({kind,attack:encounter.attack,health:encounter.health})),
    preparations:run.shop.preparations,
  });
  run.phase='battle';
  run.history=[];
  run.log=[];
  return true;
}

export function advance(run:Run){
  if(run.phase!=='result')return;
  if(run.stage===encounters.length-1){run.phase='end';return;}
  run.stage++;
  run.gold+=encounters[run.stage].gold;
  run.shop=createShop(run.seed,run.stage);
  run.battle=null;
  run.history=[];
  run.log=[];
  run.phase='shop';
}

function finishBattle(run:Run,battle:Battle,outcome:Outcome){
  const allies=new Map(battle.units.filter(unit=>unit.side===0&&!unit.temporary).map(unit=>[unit.id,unit]));
  for(const unit of run.roster){
    const result=allies.get(unit.id);
    if(!result)continue;
    unit.gainedAttack=result.bonus;
    unit.gainedHealth=result.healthBonus;
  }
  run.results.push(outcome);
  run.phase=outcome==='胜利'?'result':'end';
}

export function commitBattleWindow(run:Run,window:BattleWindow){
  const current=run.battle;
  if(run.phase!=='battle'||!current||current.id!==window.next.id||
    current.runtime.tick!==window.startTick||current.openingResolved!==window.startedAfterOpening)return false;
  run.history.push(current);
  run.battle=window.next;
  for(const event of window.events){
    if(event.phase!=='移动')run.log.push((event.tick*COMBAT_TICK_MS/1000).toFixed(1)+' 秒 · '+event.text);
  }
  if(window.outcome)finishBattle(run,window.next,window.outcome);
  return true;
}
