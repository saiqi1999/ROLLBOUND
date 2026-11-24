import {encounters,unitOffer,units} from './data.ts';
import type {Run} from './engine.ts';
import {magicTags} from './magic-tags.ts';
import {WHEEL_SIZE} from './shop/wheel.ts';

const key='rollbound.shop-wheel.v6';

export function loadRun():Run|undefined{
  try{
    const saved:Run|null=JSON.parse(localStorage.getItem(key)??'null');
    if(saved?.version===6&&encounters[saved.stage]&&Array.isArray(saved.roster)&&Array.isArray(saved.pendingRecruits)&&
      [...saved.roster,...saved.pendingRecruits].every(unit=>unit&&Object.hasOwn(units,unit.kind)&&
        (unit.tag===undefined||Object.hasOwn(magicTags,unit.tag)))&&
      Array.isArray(saved.spells)&&Array.isArray(saved.history)&&saved.shop?.board?.length===WHEEL_SIZE&&
      saved.tagInventory&&Object.entries(saved.tagInventory).every(([tag,count])=>
        Object.hasOwn(magicTags,tag)&&Number.isSafeInteger(count)&&count>0)&&
      (saved.phase!=='battle'||saved.battle?.runtime)){
      for(const offer of saved.shop.offers){
        if(offer.type==='unit'&&!offer.sold)offer.price=unitOffer(offer.kinds[0]).price;
      }
      return saved;
    }
  }catch{
    return;
  }
}

export function saveRun(run:Run){
  try{
    localStorage.setItem(key,JSON.stringify(run));
    return true;
  }catch{
    return false;
  }
}
