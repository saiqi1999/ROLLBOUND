import './style.css';
import {ARENA_ART_WAIT_MS,COMBAT_TICK_MS} from './timing.ts';
import {playbackFrames,type PlaybackFrame} from './playback.ts';
import {encounters,spells,unitEffectText,units,WEREWOLF_RECRUIT_GAIN,type Kind,type SpellKind} from './data.ts';
import {advance,commitBattleWindow,newRun,simulateBattleWindow,startBattle,type Run} from './engine.ts';
import {FIELD_LIMIT,type Battle,type BattleWindow} from './battle/model.ts';
import {magicTags,tagCount,type AppliedTag,type TagId} from './magic-tags.ts';
import {isMirrorRound,mirrorRounds} from './mirror-lineups.ts';
import {unitStats,wheelFrame} from './shop/model.ts';
import {buy,refreshShop,resolveSpin,spinCost} from './shop/rules.ts';
import {applyMagicTag} from './shop/tags.ts';
import {loadRun,saveRun} from './save.ts';
import {flushLineupLogs,lineupLogging,queueLineup,startLineupLog} from './lineup-client.ts';
import {approvePlaytestBatch,downloadPlaytestArchive,loadMirrors,playtestEnabled,uploadFinishedPlaytest} from './playtest-client.ts';
import {recordPlaytestBattle} from './playtest-run.ts';
import {art,spellArt,unitTags} from './view/common.ts';
import {playShopSpin} from './view/reels.ts';
import {paintShopBoard,paintShopControls,paintShopOpponent,paintSpinSummary,renderShop} from './view/shop.ts';
import {renderTags,slimeRemovalBenefit,tagDetails,type TagSelection} from './view/tags.ts';
import {paintBattle,renderBattle,renderResult} from './view/battle.ts';
import type * as Arena from './arena.ts';

const app=document.querySelector<HTMLElement>('#app')!;
const dialog=document.querySelector<HTMLDialogElement>('#detail')!;
const getSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const loaded=loadRun();
let run:Run=loaded??newRun(getSeed());
let spinController:AbortController|undefined;
let tagsOpen=false,tagSelection:TagSelection={notice:''};
let arena:typeof Arena|undefined,arenaReady=false,arenaToken=0,arenaWait=0;
let timer=0,startedAt=0,remaining=0,paused=false,speed=1;
let frames:PlaybackFrame[]=[],frameIndex=0,pending:BattleWindow|undefined,playbackStart:Battle|undefined;
let replayIndex:number|undefined,resumeAfterDialog=false;
const mirrorLoads=new WeakMap<Run,Promise<void>>();

if(playtestEnabled){
  const tools=document.querySelector<HTMLElement>('#playtest-tools')!;
  const button=tools.querySelector<HTMLButtonElement>('#playtest-export')!;
  const status=tools.querySelector('#playtest-export-status')!;
  tools.hidden=false;
  button.addEventListener('click',async()=>{
    button.disabled=true;
    status.textContent='正在导出…';
    try{
      await downloadPlaytestArchive();
      status.textContent='已开始下载。';
    }catch{
      status.textContent='导出失败，请稍后重试。';
    }finally{
      button.disabled=false;
    }
  });

  const approve=tools.querySelector<HTMLButtonElement>('#playtest-approve')!;
  const approvalStatus=tools.querySelector('#playtest-approve-status')!;
  approve.addEventListener('click',async()=>{
    approve.disabled=true;
    approvalStatus.textContent='正在写入认可名单…';
    try{
      const {runs,lineups}=await approvePlaytestBatch();
      approvalStatus.textContent=`已写入 ${runs} 局，共 ${lineups} 个认可阵容。`;
    }catch{
      approvalStatus.textContent='写入未确认，请稍后重试。';
      approve.disabled=false;
    }
  });
}

function flushPlaytestRun(){
  void uploadFinishedPlaytest(run,uploaded=>{if(run===uploaded)saveRun(uploaded);});
}

function save(){
  if(playtestEnabled)recordPlaytestBattle(run);
  const stored=saveRun(run);
  document.querySelector('#save-status')!.textContent=stored?'':'浏览器未能保存，本局进度仅在当前标签页有效。';
  if(run.battle&&(run.history.length===0||run.results[run.stage]))queueLineup(run);
  flushPlaytestRun();
}

function prepareMirrors(){
  const current=run;
  if(!playtestEnabled||current.phase!=='shop'||current.mirrors)return;
  const pending=mirrorLoads.get(current);
  if(pending)return pending;
  const download=loadMirrors().then(bundle=>{
    if(!bundle||current!==run)return;
    const nextRound=run.stage+(run.phase==='shop'?1:2);
    for(const round of mirrorRounds)if(round<nextRound)delete bundle.rounds[round];
    run.mirrors=bundle;
    saveRun(run);
    paintShopOpponent(app,run);
  }).finally(()=>mirrorLoads.delete(current));
  mirrorLoads.set(current,download);
  return download;
}

function launchBattle(){
  if(startBattle(run)){
    startLineupLog(run,lineupLogging||playtestEnabled);
    paused=false;
    save();
    render();
  }
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

const ruleText='<p>七店七战，落败或平局结束远征。每间商店发放金币，余额结转。第 2、4、6 战获胜各得 1 枚移除标签。</p>'+
  '<p>货架每次提供三名单位，第四格各有一半概率出法术或魔法标签。刷新花费 1 金。每店摇盘依次花费 1、1、2、2、3、3 金，依此递增。</p>'+
  '<p>点击标签架上的标签，再选棋子贴上。每枚棋子只能贴一枚标签，贴新的会覆盖原标签。位置标签在付费摇盘时生效。</p>'+
  '<p>【激活】表示商店效果，默认在付费摇盘时结算。标有具体时机的效果按对应事件结算。【激活·死亡效果】在棋子被消灭或由牧师触发时结算。</p>'+
  '<p>进店与招募后，轮盘实时显示队伍。摇盘从队伍和未用法术中随机抽取并触发联动。横、竖、斜角均算相邻。'+
  '摇盘中获得的强化永久保留。召唤的单位立即寻找随机空格入盘，受变化影响的棋子会继续结算。</p>'+
  '<p>开战时全队参加随机抽取，最多 '+FIELD_LIMIT+' 名首发，其余候补。每有两名已部署的招募单位最终阵亡，补一名候补。'+
  '战斗召唤立即入场。场上单位全部阵亡的一方落败。</p>'+
  '<p>单位向最近的敌人前进，发现射程内的敌人就停下攻击。目标阵亡或离开射程时，重新就近选敌。</p>';

function showUnit(button:HTMLButtonElement,kind:Kind){
  const unit=run.roster.find(piece=>piece.id===button.dataset.unitId);
  const stats=unit?unitStats(unit):{attack:Number(button.dataset.attack)||units[kind].atk,
    health:Number(button.dataset.health)||units[kind].hp};
  const text=unitEffectText(kind,{spellCasts:run.spellCasts,evolutionTriggers:unit?.evolutionTriggers});
  modal(units[kind].name,art(kind)+unitTags(kind)+'<p>攻击 '+stats.attack+'　生命 '+stats.health+'</p>'+
    (text?'<p>'+text+'</p>':'')+(unit?.startingArmor?'<p>初始护甲 '+unit.startingArmor+'</p>':'')+
    (unit?.tag?'<h3>'+magicTags[unit.tag].name+'标签</h3>'+tagDetails(unit.tag):''));
}

document.addEventListener('unit-info',((event:CustomEvent)=>{
  const unit=event.detail as {
    kind:Kind;hp:number;maxHp:number;atk:number;shield:number;temporary?:true;tag?:AppliedTag;cloneOf?:string;
  };
  const text=unitEffectText(unit.kind);
  modal(units[unit.kind].name+(unit.cloneOf?'（分身）':''),art(unit.kind)+unitTags(unit.kind,unit.temporary)+
    '<p>攻击 '+unit.atk+'　生命 '+unit.hp+'/'+unit.maxHp+'　护甲 '+unit.shield+'</p>'+
    (text?'<p>'+text+'</p>':'')+(unit.tag?'<h3>'+magicTags[unit.tag].name+'标签</h3>'+tagDetails(unit.tag):''));
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
  window.clearTimeout(arenaWait);
  arenaWait=0;
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
  const notice=app.querySelector<HTMLElement>('#arena-notice')!;
  const ready=(message?:string)=>{
    if(token!==arenaToken)return;
    window.clearTimeout(arenaWait);
    arenaWait=0;
    notice.hidden=message===undefined;
    if(message)notice.textContent=message;
    if(arenaReady)return;
    arenaReady=true;
    schedule();
  };
  arenaWait=window.setTimeout(()=>ready('画面仍在加载，战斗继续进行。'),ARENA_ART_WAIT_MS);
  void import('./arena.ts').then(module=>{
    if(token!==arenaToken)return;
    arena=module;
    module.mountArena(host,currentState(),ready);
    module.paintArena(currentState(),currentFrame(),speed,paused);
  }).catch(error=>{
    if(token!==arenaToken)return;
    console.error('Unable to load the battle arena',error);
    arena?.closeArena();
    arena=undefined;
    ready('战斗画面暂不可用，仍可查看战报。');
  });
  paint();
}

function render(){
  if(run.phase==='shop'){
    if(tagsOpen)renderTags(app,run,tagSelection);
    else renderShop(app,run);
  }else if(run.phase==='battle'){
    mountBattle();
  }else renderResult(app,run);
}

function refreshTagPage(focus:string){
  const scroll=app.querySelector('.tag-choices')?.scrollLeft??0;
  render();
  const choices=app.querySelector('.tag-choices');
  if(choices)choices.scrollLeft=scroll;
  app.querySelector<HTMLElement>(focus)?.focus({preventScroll:true});
}

app.addEventListener('click',event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if(!button||button.disabled)return;
  const action=button.dataset.act;
  if(spinController){
    if(action==='skip-spin')spinController.abort();
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
  if(button.dataset.tagInfo){
    const tag=button.dataset.tagInfo as TagId;
    modal(magicTags[tag].name+'标签',tagDetails(tag)+'<p>购买后，在「打标签」页使用。</p>');
    return;
  }
  if(button.dataset.buyIndex!==undefined){
    const index=Number(button.dataset.buyIndex);
    const priorCount=run.roster.length;
    if(!buy(run,index))return;
    const offer=run.shop.offers[index];
    const keepFocus=document.activeElement===button;
    save();
    if(offer.type==='unit')paintShopBoard(app,run);
    paintShopControls(app,run);
    if(keepFocus)button.closest('.offer')?.querySelector<HTMLElement>('.offer-art')?.focus({preventScroll:true});
    const kind=offer.type==='unit'?offer.kinds[0]:undefined;
    const extra=kind==='king'?'与 2 名骷髅兵':kind==='bat'?'，获得'+spells[run.spells.at(-1)!.kind].name:'';
    const growingWolves=kind?run.roster.slice(0,priorCount).filter(unit=>unit.kind==='werewolf').length:0;
    const growth=growingWolves?growingWolves+' 名狼人永久 +'+WEREWOLF_RECRUIT_GAIN+'/+'+WEREWOLF_RECRUIT_GAIN:'';
    const status=(kind?'已招募 ':'已购买 ')+offer.title+(offer.type==='tag'?'标签':'')+extra+
      (growth?'，'+growth:'')+'，剩余 '+run.gold+' 金。';
    app.querySelector('#purchase-status')!.textContent=status;
    if(kind){
      const added=new Set(run.roster.slice(priorCount).map(unit=>unit.id));
      const onWheel=run.shop.board.filter(slot=>slot&&added.has(slot.id)).length;
      const placement=onWheel===added.size?'已上盘':onWheel===0?'轮盘已满':
        onWheel+' 名上盘，'+(added.size-onWheel)+' 名留在队伍';
      app.querySelector('#spin-event')!.textContent='已招募 '+offer.title+extra+' · '+placement+(growth?' · '+growth:'')+'。';
    }
    return;
  }
  if(button.dataset.selectTag&&tagsOpen){
    tagSelection={...tagSelection,tag:button.dataset.selectTag as TagId,notice:''};
    refreshTagPage('.tag-choice[aria-pressed="true"]');
    return;
  }
  if(button.dataset.tagTarget&&tagsOpen){
    tagSelection={...tagSelection,unitId:button.dataset.tagTarget,notice:''};
    refreshTagPage('.tag-unit[aria-pressed="true"]');
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
    case 'manage-tags':{
      const tag=button.dataset.heldTag as TagId|undefined;
      if(!tag||!tagCount(run.tagInventory,tag))break;
      tagSelection={tag,notice:''};
      tagsOpen=true;
      render();
      window.scrollTo(0,0);
      app.querySelector<HTMLElement>('.tag-choice[aria-pressed="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
      app.querySelector<HTMLElement>('[data-act="back-shop"]')?.focus({preventScroll:true});
      break;
    }
    case 'back-shop':{
      const tag=tagSelection.tag;
      tagsOpen=false;
      tagSelection={notice:''};
      render();
      window.scrollTo(0,0);
      const entry=tag?app.querySelector<HTMLElement>('[data-held-tag="'+tag+'"]'):null;
      (entry??app.querySelector<HTMLElement>('.held-tag')??app.querySelector<HTMLElement>('.offer-art'))?.focus({preventScroll:true});
      break;
    }
    case 'apply-tag':{
      const {tag,unitId}=tagSelection;
      const selected=run.roster.find(unit=>unit.id===unitId);
      if(!tagsOpen||!tag||!selected)break;
      const result=applyMagicTag(run,selected.id,tag);
      if(!result.ok)break;
      const name=units[selected.kind].name;
      tagSelection={
        tag:tagCount(run.tagInventory,tag)>0?tag:undefined,
        unitId:result.removed?undefined:unitId,
        notice:result.removed?'已移除 '+name+'。'+(selected.kind==='slime'&&run.roster.length?slimeRemovalBenefit:''):
          name+'已贴上'+magicTags[tag].name+'标签。'+(result.previous?'原有'+magicTags[result.previous].name+'标签已覆盖。':''),
      };
      save();
      refreshTagPage(result.removed?'.tag-unit, .tags-heading button':'.tag-unit[aria-pressed="true"]');
      break;
    }
    case 'fight':{
      const current=run;
      const download=isMirrorRound(run.stage+1)?prepareMirrors():undefined;
      if(download){
        button.disabled=true;
        void download.then(()=>{
          if(run===current&&run.phase==='shop'&&!spinController&&!tagsOpen){
            paintShopControls(app,run);
            launchBattle();
          }
        });
      }else{
        launchBattle();
      }
      break;
    }
    case 'pause':togglePause();break;
    case 'step':paused=true;stopTimer();tick();break;
    case 'speed':stopTimer();speed=speed===1?2:speed===2?4:1;paintControls();schedule();break;
    case 'skip':fastFinish();break;
    case 'advance':advance(run);save();render();void prepareMirrors();break;
    case 'reset':run=newRun(getSeed());save();render();void prepareMirrors();break;
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
  if(!document.hidden){
    void flushLineupLogs();
    flushPlaytestRun();
  }
});

window.addEventListener('online',()=>{
  void flushLineupLogs();
  flushPlaytestRun();
  void prepareMirrors();
});
render();
void prepareMirrors();
if(run.phase==='shop')void import('./arena.ts').catch(()=>{/* Battle startup can still use its fallback. */});
if(!loaded)save();
else{
  queueLineup(run);
  flushPlaytestRun();
}
void flushLineupLogs();
