import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {encounters,REFRESH_COST,REQUIRED_WINS} from '../src/data.ts';
import {advance,buy,canStartBattle,commitRoll,newRun,refreshShop,removalMarkers,removeUnit,startBattle,step} from '../src/engine.ts';
import {pick,shuffle} from '../src/battle/random.ts';

function mixSeed(seed) {
  let value = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function bestPurchase(run,random) {
  const available = run.offers.flatMap((offer,index) =>
    !offer.sold && offer.price <= run.gold ? [{offer,index}] : []);
  const needsUnit = !canStartBattle(run);
  let largestSpend = 0;
  let plans = [];
  for (let mask = 1; mask < 2**available.length; mask++) {
    const combination = available.filter((_,index) => mask & (1 << index));
    if (needsUnit && !combination.some(({offer}) => !offer.spell)) continue;
    const cost = combination.reduce((sum,{offer}) => sum + offer.price, 0);
    if (cost > run.gold || cost < largestSpend) continue;
    if (cost > largestSpend) {
      largestSpend = cost;
      plans = [];
    }
    plans.push(combination.map(({index}) => index));
  }
  return plans.length ? shuffle(pick(plans,random),random) : [];
}

export function spendShopGold(run) {
  const random = {rng:mixSeed(run.seed ^ Math.imul(run.stage+1,0x7f4a7c15))};
  while (run.phase === 'shop' && run.gold > 0) {
    const purchases = bestPurchase(run,random);
    if (purchases.length) {
      for (const index of purchases) {
        if (!buy(run,index)) throw Error('Invalid purchase in shop '+(run.stage+1));
      }
    } else {
      // Leave at least one coin for a unit after spending the refresh cost.
      if (run.gold <= REFRESH_COST || !refreshShop(run)) break;
    }
  }
}

export function simulateDifficulty(count,offset=100000,{removeSlimes=false}={}) {
  const stages=encounters.map(()=>({reached:0,wins:0,losses:0,draws:0,unspent:0,spentAll:0,roster:0,refreshes:0}));
  let clears=0;
  for(let index=0;index<count;index++){
    const run=newRun(mixSeed(index+offset));
    while(run.phase==='shop'){
      const stage=stages[run.stage];
      spendShopGold(run);
      if(removeSlimes){
        while(run.roster.length>1&&removalMarkers(run)){
          const index=run.roster.indexOf('slime');
          if(index<0||!removeUnit(run,index))break;
        }
      }
      stage.reached++;
      stage.unspent+=run.gold;
      stage.spentAll+=Number(run.gold===0);
      stage.roster+=run.roster.length;
      stage.refreshes+=run.refreshes;
      if(!startBattle(run))throw Error('Opening shop did not recruit a unit');
      while(run.phase==='battle')commitRoll(run,step(run.battle,{captureEvents:false}));
      const result=run.results.at(-1);
      if(result==='胜利')stage.wins++;
      else if(result==='落败')stage.losses++;
      else stage.draws++;
      advance(run);
    }
    if(run.results.filter(result=>result==='胜利').length===REQUIRED_WINS)clears++;
  }
  return {count,clears,stages};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [sample,seedOffset,policy]=process.argv.slice(2);
  const count=Number(sample??5000),offset=Number(seedOffset??100000);
  if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(offset)||offset<0||
     (policy!==undefined&&policy!=='--remove-slimes')){
    throw Error('Usage: node scripts/simulate-difficulty.mjs [positive sample count] [nonnegative seed offset] [--remove-slimes]');
  }
  const removeSlimes=policy==='--remove-slimes';
  const report=simulateDifficulty(count,offset,{removeSlimes});
  const percent=(n,d)=>d?(100*n/d).toFixed(1)+'%':'—';
  const mean=(n,d)=>d?(n/d).toFixed(2):'—';
  console.log('样本 '+count+' · 种子偏移 '+offset+' · '+(removeSlimes?'优先移除史莱姆':'保留阵容'));
  console.table(report.stages.map((row,i)=>({
    '关卡':i+1,'发放金币':encounters[i].gold,'入关':row.reached,'胜':row.wins,'负':row.losses,'平':row.draws,
    '入关后胜率':percent(row.wins,row.reached),'平均余款':mean(row.unspent,row.reached),
    '花光率':percent(row.spentAll,row.reached),'平均阵容':mean(row.roster,row.reached),
    '平均刷新':mean(row.refreshes,row.reached),
  })));
  console.log('七战通关 '+report.clears+'/'+count+' · '+percent(report.clears,count));
}
