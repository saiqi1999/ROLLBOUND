import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {encounters,REFRESH_COST,REQUIRED_WINS} from '../src/data.ts';
import {advance,commitBattleWindow,newRun,removalMarkers,removeUnit,simulateBattleWindow,startBattle} from '../src/engine.ts';
import {buy,refreshShop,resolveSpin,spinCost} from '../src/shop/rules.ts';
import {FIELD_LIMIT} from '../src/battle/model.ts';
import {pick,shuffle} from '../src/battle/random.ts';

function mixSeed(seed){
  let value=Math.imul(seed^(seed>>>16),0x21f0aaad);
  value=Math.imul(value^(value>>>15),0x735a2d97);
  return (value^(value>>>15))>>>0;
}

function bestPurchase(run,random,budget,buySpells){
  const available=run.shop.offers.flatMap((offer,index)=>
    !offer.sold&&offer.price<=budget&&(buySpells||!offer.spell)?[{offer,index}]:[]);
  let bestSpend=0,plans=[];
  for(let mask=1;mask<2**available.length;mask++){
    const combination=available.filter((_,index)=>mask&(1<<index));
    if(!run.roster.length&&!combination.some(({offer})=>!offer.spell))continue;
    const cost=combination.reduce((sum,{offer})=>sum+offer.price,0);
    if(cost>budget||cost<bestSpend)continue;
    if(cost>bestSpend){bestSpend=cost;plans=[];}
    plans.push(combination.map(({index})=>index));
  }
  return plans.length?shuffle(pick(plans,random),random):[];
}

export function spendShopGold(run,{spins=2,maxRefreshes=1,buySpells=true}={}){
  const random={rng:mixSeed(run.seed^Math.imul(run.stage+1,0x7f4a7c15))};
  const reserve=Array.from({length:spins},(_,index)=>spinCost(index)).reduce((total,cost)=>total+cost,0);
  while(run.phase==='shop'&&run.gold>reserve){
    const budget=run.gold-reserve;
    const purchases=bestPurchase(run,random,budget,buySpells);
    if(purchases.length){
      for(const index of purchases)if(!buy(run,index))throw Error('Invalid simulated purchase');
    }else if(run.shop.refreshes>=maxRefreshes||budget<=REFRESH_COST||!refreshShop(run))break;
  }
  for(let count=0;count<spins;count++){
    if(!resolveSpin(run))break;
  }
}

export function simulateDifficulty(count,offset=100000,{removeSlimes=false,...shopPolicy}={}){
  const stages=encounters.map(()=>({reached:0,wins:0,losses:0,draws:0,unspent:0,roster:0,spins:0,full:0,reserves:0}));
  for(let index=0;index<count;index++){
    const run=newRun(mixSeed(index+offset));
    while(run.phase==='shop'){
      const stage=stages[run.stage];
      spendShopGold(run,shopPolicy);
      if(removeSlimes){
        while(run.roster.length>1&&removalMarkers(run)){
          const slime=run.roster.find(unit=>unit.kind==='slime');
          if(!slime||!removeUnit(run,slime.id))break;
        }
      }
      stage.reached++;
      stage.unspent+=run.gold;
      stage.roster+=run.roster.length;
      stage.spins+=run.shop.paidSpins;
      stage.full+=Number(run.roster.length>=FIELD_LIMIT);
      stage.reserves+=Number(run.roster.length>FIELD_LIMIT);
      if(!startBattle(run)){
        stage.losses++;
        break;
      }
      while(run.phase==='battle'){
        commitBattleWindow(run,simulateBattleWindow(run.battle,{captureEvents:false}));
      }
      const result=run.results.at(-1);
      if(result==='胜利')stage.wins++;
      else if(result==='落败')stage.losses++;
      else stage.draws++;
      advance(run);
    }
  }
  return {count,clears:stages[REQUIRED_WINS-1].wins,stages};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [sample,seedOffset,...flags]=process.argv.slice(2);
  const count=Number(sample??500),offset=Number(seedOffset??100000);
  if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(offset)||offset<0||
    flags.some(flag=>!['--remove-slimes','--recruit','--spin'].includes(flag))){
    throw Error('Usage: node scripts/simulate-difficulty.mjs [count] [seed offset] [--remove-slimes] [--recruit|--spin]');
  }
  const shopPolicy=flags.includes('--recruit')?{spins:0,maxRefreshes:Infinity,buySpells:false}:
    flags.includes('--spin')?{spins:4}:{};
  const report=simulateDifficulty(count,offset,{...shopPolicy,removeSlimes:flags.includes('--remove-slimes')});
  const percent=(n,d)=>d?(100*n/d).toFixed(1)+'%':'—';
  const mean=(n,d)=>d?(n/d).toFixed(2):'—';
  console.table(report.stages.map((row,index)=>({
    '战斗':index+1,'金币':encounters[index].gold,'进入':row.reached,'胜':row.wins,'负':row.losses,'平':row.draws,
    '胜率':percent(row.wins,row.reached),'平均队员':mean(row.roster,row.reached),
    '满编':percent(row.full,row.reached),'候补':percent(row.reserves,row.reached),
    '平均摇盘':mean(row.spins,row.reached),'平均余款':mean(row.unspent,row.reached),
  })));
  console.log('七战通关 '+report.clears+'/'+count+' · '+percent(report.clears,count));
}
