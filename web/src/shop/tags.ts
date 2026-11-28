import {SLIME_REMOVAL_GAIN} from '../data.ts';
import type {Run} from '../engine.ts';
import {GROWTH_TAG_GAIN,tagCount,type AppliedTag,type TagId} from '../magic-tags.ts';
import {grantGrowth} from './model.ts';
import {detachShopUnit} from './rules.ts';

type TagActionResult =
  | {ok:true;unitId:string;previous?:AppliedTag;removed:boolean}
  | {ok:false;reason:'notShop'|'outOfStock'|'unknownTarget'|'alreadyApplied'};

export function applyMagicTag(run:Run,unitId:string,tag:TagId):TagActionResult{
  if(run.phase!=='shop')return {ok:false,reason:'notShop'};
  const stock=tagCount(run.tagInventory,tag);
  if(!stock)return {ok:false,reason:'outOfStock'};
  const unit=run.roster.find(candidate=>candidate.id===unitId);
  if(!unit)return {ok:false,reason:'unknownTarget'};
  if(unit.tag===tag)return {ok:false,reason:'alreadyApplied'};

  if(stock===1)delete run.tagInventory[tag];
  else run.tagInventory[tag]=stock-1;

  const previous=unit.tag;
  if(tag!=='remove'){
    unit.tag=tag;
    return {ok:true,unitId,previous,removed:false};
  }

  detachShopUnit(run,unitId);
  const slot=run.shop.board.findIndex(symbol=>symbol?.id===unitId);
  if(slot>=0)run.shop.board[slot]=null;
  if(unit.kind==='slime'){
    for(const ally of run.roster)grantGrowth(ally,{attack:SLIME_REMOVAL_GAIN,health:SLIME_REMOVAL_GAIN});
  }
  return {ok:true,unitId,previous,removed:true};
}

export function applyShopEndTags(run:Run){
  for(const unit of run.roster){
    if(unit.tag==='growth')grantGrowth(unit,{attack:GROWTH_TAG_GAIN,health:GROWTH_TAG_GAIN});
  }
}
