import {encounters,units} from './data.ts';
import type {Run} from './engine.ts';
import {restoreShopBoard} from './shop/rules.ts';

const key='rollbound.shop-wheel.v4';

export function loadRun():Run|undefined{
  try{
    const saved:Run|null=JSON.parse(localStorage.getItem(key)??'null');
    if(saved?.version===4&&encounters[saved.stage]&&Array.isArray(saved.roster)&&
      saved.roster.every(unit=>unit&&Object.hasOwn(units,unit.kind))&&
      Array.isArray(saved.spells)&&Array.isArray(saved.history)&&saved.shop?.preparations&&
      (saved.phase!=='battle'||saved.battle?.runtime)){
      restoreShopBoard(saved);
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
