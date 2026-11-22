import {encounters,units} from './data.ts';
import type {Run} from './engine.ts';
import {grantGrowth,type OpeningSpell,type ShopState,type UnitInstance} from './shop/model.ts';
import {restoreShopBoard} from './shop/rules.ts';

const key='rollbound.shop-wheel.v5';
const legacyKey='rollbound.shop-wheel.v4';

type LegacyRun=Omit<Run,'version'|'roster'|'shop'|'pendingRecruits'>&{
  version:4;
  roster:Omit<UnitInstance,'startingArmor'>[];
  shop:Omit<ShopState,'openingSpells'>&{
    archersGrown?:string[];
    preparations:{
      openingSpells:OpeningSpell[];
      buffs:Record<string,Record<string,{attack?:number;health?:number;shield?:number}>>;
    };
  };
};

function migrate(saved:LegacyRun):Run{
  const {preparations,archersGrown,...shop}=saved.shop;
  const roster=saved.roster.map(piece=>{
    const unit={...piece,startingArmor:0};
    if(saved.phase==='shop'){
      for(const buff of Object.values(preparations.buffs[piece.id]??{})){
        grantGrowth(unit,{attack:buff.attack,health:buff.health,armor:buff.shield});
      }
    }
    return unit;
  });
  return {...saved,version:5,roster,pendingRecruits:[],shop:{...shop,openingSpells:preparations.openingSpells}};
}

export function loadRun():Run|undefined{
  try{
    const saved:Run|LegacyRun|null=JSON.parse(localStorage.getItem(key)??localStorage.getItem(legacyKey)??'null');
    if((saved?.version===4||saved?.version===5)&&encounters[saved.stage]&&Array.isArray(saved.roster)&&
      saved.roster.every(unit=>unit&&Object.hasOwn(units,unit.kind))&&
      Array.isArray(saved.spells)&&Array.isArray(saved.history)&&saved.shop&&
      (saved.phase!=='battle'||saved.battle?.runtime)){
      const run=saved.version===4?migrate(saved):saved;
      run.pendingRecruits??=[];
      restoreShopBoard(run);
      if(saved.version===4)run.shop.lastSpin=null;
      return run;
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
