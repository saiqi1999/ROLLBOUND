import './style.css';
import {COMBAT_TICK_MS} from './timing.ts';
import {playbackFrames,type PlaybackFrame} from './playback.ts';
import {encounters,spells,units,wizardEntryGain,type Kind,type SpellKind} from './data.ts';
import {advance,commitBattleWindow,newRun,removeUnit,simulateBattleWindow,startBattle,type Run} from './engine.ts';
import {FIELD_LIMIT,type Battle,type BattleWindow} from './battle/model.ts';
import {unitStats,wheelFrame} from './shop/model.ts';
import {buy,refreshShop,resolveSpin,spinCost} from './shop/rules.ts';
import {loadRun,saveRun} from './save.ts';
import {art,spellArt,unitTags} from './view/common.ts';
import {playShopSpin} from './view/reels.ts';
import {
  changeShopPane,paintShopBoard,paintShopControls,paintSpinSummary,renderRemoval,renderShop,
  slimeRemovalBenefit,type ShopPane,
} from './view/shop.ts';
import {paintBattle,renderBattle,renderResult} from './view/battle.ts';
import type * as Arena from './arena.ts';

const app=document.querySelector<HTMLElement>('#app')!;
const dialog=document.querySelector<HTMLDialogElement>('#detail')!;
const getSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const loaded=loadRun();
let run:Run=loaded??newRun(getSeed());
let shopPane:ShopPane='wheel',spinController:AbortController|undefined;
let removalOpen=false,removalSelection:string|undefined,removalNotice='';
let arena:typeof Arena|undefined,arenaReady=false,arenaToken=0;
let timer=0,startedAt=0,remaining=0,paused=false,speed=1;
let frames:PlaybackFrame[]=[],frameIndex=0,pending:BattleWindow|undefined,playbackStart:Battle|undefined;
let replayIndex:number|undefined,resumeAfterDialog=false;

function save(){
  const stored=saveRun(run);
  document.querySelector('#save-status')!.textContent=stored?'':'浏览器未能保存，本局进度仅在当前标签页有效。';
}

function modal(title:string,html:string){
  if(!dialog.open){
    resumeAfterDialog=(replayIndex!==undefined||run.phase==='battle')&&!paused;
    if(resumeAfterDialog)togglePause();
  }
  dialog.querySelector('#dialog-inner')!.innerHTML='<h2>'+title+'</h2>'+html;
  if(!dialog.open)dialog.showModal();
}

dialog.querySelector('#close')!.addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{
  if(resumeAfterDialog&&paused&&(replayIndex!==undefined||run.phase==='battle'))togglePause();
  resumeAfterDialog=false;
});

const ruleText='<p>七店七战，落败或平局结束远征。每间商店发放金币，余额结转。第 2、4、6 战获胜各得 1 个移除标记。</p>'+
  '<p>货架每次提供三名单位和一张法术，刷新花费 1 金。每店摇盘依次花费 1、1、2、2、3、3 金，依此递增。</p>'+
  '<p>进店与招募后，轮盘实时显示队伍。摇盘从队伍和未用法术中随机抽取并触发联动。横、竖、斜角均算相邻。'+
  '摇盘中获得的强化永久保留。召唤的单位立即寻找随机空格入盘，受变化影响的棋子会继续结算。</p>'+
  '<p>开战时全队参加随机抽取，最多 '+FIELD_LIMIT+' 名首发，其余候补。每有两名已部署的招募单位最终阵亡，补一名候补。'+
  '战斗召唤立即入场。场上单位全部阵亡的一方落败。</p>';

function showUnit(button:HTMLButtonElement,kind:Kind){
  const unit=run.roster.find(piece=>piece.id===button.dataset.unitId);
  const stats=unit?unitStats(unit):{attack:Number(button.dataset.attack)||units[kind].atk,
    health:Number(button.dataset.health)||units[kind].hp};
  const gain=wizardEntryGain(run.spellCasts);
  modal(units[kind].name,art(kind)+unitTags(kind)+'<p>攻击 '+stats.attack+'　生命 '+stats.health+'</p>'+
    '<p>'+units[kind].text+'</p>'+(unit?.startingArmor?'<p>初始护甲 '+unit.startingArmor+'</p>':'')+
    (kind==='wizard'?'<p>当前增益 +'+gain+'/+'+gain+'</p>':''));
}

document.addEventListener('unit-info',((event:CustomEvent)=>{
  const unit=event.detail as {kind:Kind;name:string;hp:number;maxHp:number;atk:number;shield:number;temporary?:true};
  modal(unit.name,art(unit.kind)+unitTags(unit.kind,unit.temporary)+'<p>攻击 '+unit.atk+'　生命 '+unit.hp+'/'+unit.maxHp+
    '　护甲 '+unit.shield+'</p><p>'+units[unit.kind].text+'</p>');
}) as EventListener);

async function spinShop(){
  const previous=wheelFrame(run.shop.board,run.roster);
  const paidGold=run.gold-spinCost(run.shop.paidSpins);
  const result=resolveSpin(run);
  if(!result)return;
  save();
  const controller=spinController=new AbortController();
  const host=app.querySelector<HTMLElement>('#reels')!;
  const message=app.querySelector('#spin-event')!;
  host.setAttribute('aria-busy','true');
  paintShopControls(app,run,true);
  app.querySelector('#shop-gold')!.textContent=String(paidGold);
  message.textContent='转动中…';
  try{
    await playShopSpin(host,previous,result,controller.signal,event=>{message.textContent=event.text;});
  }catch(error){
    console.error('Unable to play the shop reels',error);
    paintShopBoard(app,run);
  }finally{
    spinController=undefined;
    if(host.isConnected){
      host.removeAttribute('aria-busy');
      paintShopControls(app,run);
      paintSpinSummary(app,run);
      const spin=app.querySelector<HTMLElement>('[data-act="spin"]:enabled');
      if(document.activeElement===document.body)spin?.focus({preventScroll:true});
    }
  }
}

function currentFrame(){return frames[frameIndex-1];}
function currentState(){return currentFrame()?.state??playbackStart??run.battle!;}
function paintControls(){
  arena?.setArenaPlayback(speed,paused);
  app.querySelector('#pause')!.textContent=paused?'继续':'暂停';
  app.querySelector('#speed')!.textContent=speed+'×';
}
function paint(){
  paintBattle(app,currentState(),currentFrame(),replayIndex!==undefined);
  paintControls();
  arena?.paintArena(currentState(),currentFrame(),speed,paused);
}
function stopTimer(){
  if(!timer)return;
  window.clearTimeout(timer);
  timer=0;
  remaining=Math.max(0,remaining-(performance.now()-startedAt)*speed);
}
function schedule(reset=false){
  if(reset){
    stopTimer();
    remaining=currentFrame()?.duration??0;
  }
  if(!arenaReady||paused||timer)return;
  startedAt=performance.now();
  timer=window.setTimeout(()=>{
    timer=0;
    remaining=0;
    tick();
  },remaining/speed);
}

function prepareWindow(){
  if(replayIndex!==undefined){
    const start=run.history[replayIndex];
    const end=run.history[replayIndex+1]??run.battle!;
    playbackStart=start;
    pending=simulateBattleWindow(start,{tickLimit:end.runtime.tick-start.runtime.tick});
  }else{
    playbackStart=run.battle!;
    pending=simulateBattleWindow(playbackStart);
  }
  frames=playbackFrames(pending);
  frameIndex=0;
}

function tick(){
  while(replayIndex!==undefined||run.phase==='battle'){
    if(!pending)prepareWindow();
    if(frameIndex<frames.length){
      frameIndex++;
      paint();
      schedule(true);
      return;
    }
    const finished=pending!;
    pending=undefined;
    playbackStart=undefined;
    frames=[];
    frameIndex=0;
    if(replayIndex!==undefined){
      replayIndex++;
      if(replayIndex<run.history.length)continue;
      break;
    }
    commitBattleWindow(run,finished);
    save();
  }
  leaveBattle();
  render();
}

function togglePause(){
  paused=!paused;
  if(paused)stopTimer();
  else schedule();
  paintControls();
}

function leaveBattle(){
  stopTimer();
  arenaReady=false;
  arenaToken++;
  arena?.closeArena();
  arena=undefined;
  replayIndex=undefined;
  pending=undefined;
  playbackStart=undefined;
  frames=[];
  frameIndex=0;
  remaining=0;
}

function fastFinish(){
  if(replayIndex===undefined){
    while(run.phase==='battle'){
      const window=pending??simulateBattleWindow(run.battle!,{captureFrames:false});
      if(!commitBattleWindow(run,window))break;
      pending=undefined;
    }
    save();
  }
  leaveBattle();
  render();
}

function mountBattle(){
  const token=++arenaToken;
  arenaReady=false;
  const host=renderBattle(app,run,replayIndex!==undefined);
  const ready=()=>{
    if(token!==arenaToken)return;
    arenaReady=true;
    schedule();
  };
  void import('./arena.ts').then(module=>{
    if(token!==arenaToken)return;
    arena=module;
    module.mountArena(host,ready);
    module.paintArena(currentState(),currentFrame(),speed,paused);
  }).catch(error=>{
    if(token!==arenaToken)return;
    console.error('Unable to load the battle arena',error);
    ready();
  });
  paint();
}

function render(){
  if(run.phase==='shop'){
    if(removalOpen)renderRemoval(app,run,removalSelection,removalNotice);
    else renderShop(app,run,shopPane);
  }else if(run.phase==='battle'){
    mountBattle();
  }else renderResult(app,run);
}

app.addEventListener('click',event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if(!button||button.disabled)return;
  const action=button.dataset.act;
  if(spinController){
    if(action==='skip-spin')spinController.abort();
    return;
  }
  if(button.dataset.shopPane){
    shopPane=button.dataset.shopPane as ShopPane;
    changeShopPane(app,shopPane);
    return;
  }
  if(button.dataset.kind){
    showUnit(button,button.dataset.kind as Kind);
    return;
  }
  if(button.dataset.spell){
    const kind=button.dataset.spell as SpellKind;
    modal(spells[kind].name,spellArt(kind)+'<p>'+spells[kind].text+'</p><p>在商店摇出时消耗。</p>');
    return;
  }
  if(button.dataset.buyIndex!==undefined){
    const index=Number(button.dataset.buyIndex);
    const priorCount=run.roster.length;
    if(!buy(run,index))return;
    const offer=run.shop.offers[index];
    const keepFocus=document.activeElement===button;
    save();
    if(!offer.spell)paintShopBoard(app,run);
    paintShopControls(app,run);
    if(keepFocus)button.closest('.offer')?.querySelector<HTMLElement>('.offer-art')?.focus({preventScroll:true});
    const extra=offer.kinds[0]==='king'?'与 2 名骷髅兵':offer.kinds[0]==='bat'?'，获得'+spells[run.spells.at(-1)!.kind].name:'';
    const status=(offer.spell?'已购买 ':'已招募 ')+offer.title+extra+'，剩余 '+run.gold+' 金。';
    app.querySelector('#purchase-status')!.textContent=status;
    if(!offer.spell){
      const added=new Set(run.roster.slice(priorCount).map(unit=>unit.id));
      const onWheel=run.shop.board.filter(slot=>slot&&added.has(slot.id)).length;
      const placement=onWheel===added.size?'已上盘':onWheel===0?'轮盘已满':
        onWheel+' 名上盘，'+(added.size-onWheel)+' 名留在队伍';
      app.querySelector('#spin-event')!.textContent='已招募 '+offer.title+extra+' · '+placement+'。';
    }
    return;
  }
  if(button.dataset.removeId&&removalOpen){
    removalSelection=button.dataset.removeId;
    removalNotice='';
    render();
    app.querySelector<HTMLElement>('.removal-unit[aria-pressed="true"]')?.focus();
    return;
  }

  switch(action){
    case 'rules':modal('玩法说明',ruleText);break;
    case 'spin':void spinShop();break;
    case 'refresh':
      if(refreshShop(run)){
        const keepFocus=document.activeElement===button;
        save();
        render();
        if(keepFocus)app.querySelector<HTMLElement>('[data-act="refresh"]:enabled,.offer-art')?.focus({preventScroll:true});
      }
      break;
    case 'manage-removal':
      removalOpen=true;render();
      app.querySelector<HTMLElement>('[data-act="back-shop"]')?.focus();
      break;
    case 'back-shop':
      removalOpen=false;removalSelection=undefined;removalNotice='';render();
      app.querySelector<HTMLElement>('[data-act="manage-removal"]')?.focus();
      break;
    case 'confirm-removal':{
      const selected=run.roster.find(unit=>unit.id===removalSelection);
      if(!removalOpen||!selected||!removeUnit(run,selected.id))break;
      removalSelection=undefined;
      removalNotice='已移除 '+units[selected.kind].name+'。'+
        (selected.kind==='slime'&&run.roster.length?slimeRemovalBenefit:'');
      save();render();
      (app.querySelector<HTMLElement>('.removal-unit:enabled')??app.querySelector<HTMLElement>('[data-act="back-shop"]'))?.focus();
      break;
    }
    case 'fight':if(startBattle(run)){paused=false;save();render();}break;
    case 'pause':togglePause();break;
    case 'step':paused=true;stopTimer();tick();break;
    case 'speed':stopTimer();speed=speed===1?2:speed===2?4:1;paintControls();schedule();break;
    case 'skip':fastFinish();break;
    case 'advance':advance(run);shopPane='wheel';save();render();break;
    case 'reset':run=newRun(getSeed());shopPane='wheel';save();render();break;
    case 'log':{
      const current=pending&&replayIndex===undefined?
        pending.events.slice(0,currentFrame()?.until??0).filter(entry=>entry.phase!=='移动').map(entry=>
          (entry.tick*COMBAT_TICK_MS/1000).toFixed(1)+' 秒 · '+entry.text):[];
      const lines=[...run.log,...current];
      modal('战报',lines.length?'<ol>'+lines.map(line=>'<li>'+line+'</li>').join('')+'</ol>':'<p>双方正在列阵。</p>');
      break;
    }
    case 'replay':
      replayIndex=Number(app.querySelector<HTMLSelectElement>('#review-window')!.value);
      prepareWindow();
      paused=false;
      mountBattle();
      break;
  }
});

document.addEventListener('keydown',event=>{
  if(dialog.open||(replayIndex===undefined&&run.phase!=='battle')||['BUTTON','SELECT'].includes((event.target as HTMLElement).tagName))return;
  if(event.code==='Space'){event.preventDefault();togglePause();}
  if(event.code==='ArrowRight'&&paused){event.preventDefault();tick();}
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&(run.phase==='battle'||replayIndex!==undefined)&&!paused)togglePause();
});

render();
if(!loaded)save();
