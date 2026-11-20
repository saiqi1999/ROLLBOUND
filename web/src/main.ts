import './style.css';
import {ATTACK_MS, LINK_MS} from './timing.ts';
import {units,encounters,type Kind} from './data.ts';
import {newRun,buy,startBattle,advance,step,commitRoll,type Run,type Moment,type Battle} from './engine.ts';
import {scenery} from './landscape.ts';
import type * as Arena from './arena.ts';
const key='rollbound.trial.v1',base=import.meta.env.BASE_URL+'art/';
const app=document.querySelector<HTMLElement>('#app')!, dialog=document.querySelector<HTMLDialogElement>('#detail')!;
const getSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
function read():Run{
  try{
    const saved:Run|null=JSON.parse(localStorage.getItem(key)??'null');
    if(saved?.version===1&&Array.isArray(saved.roster)&&saved.roster.every(k=>k in units)&&encounters[saved.stage]&&Array.isArray(saved.history)){
      // Continue the live battle under the current rules. Historical replay frames retain their rules.
      if(saved.phase==='battle'&&saved.battle)delete saved.battle.hp;
      return saved;
    }
  }catch{}
  return newRun(getSeed());
}
let run=read(), selected=1, timer=0, paused=false, speed=1, index=0, pending:ReturnType<typeof step>|undefined;
let arena:typeof Arena|undefined, token=0,replay=false,resumeAfterDialog=false,saveWarning=false;
function save(){try{localStorage.setItem(key,JSON.stringify(run));}catch{saveWarning=true;}}
const art=(k:Kind,cls='')=>'<img class="sprite '+cls+'" src="'+base+k+'.png" alt="">';
const heart='♥', coin='<i class="coin" aria-hidden="true"></i>';
const counts=(kinds:Kind[])=>Object.entries(kinds.reduce((a,k)=>(a[k]=(a[k]??0)+1,a),{} as Partial<Record<Kind,number>>)) as [Kind,number][];
function header(){
  return '<header><div class="brand"><span class="brandmark" aria-hidden="true">◆</span><div><strong>ROLLBOUND</strong><small>轮 盘 战 记</small></div></div><nav aria-label="旅程">'+[1,2,3].map((n,i)=>'<span class="'+(i===run.stage?'now':i<run.stage?'past':'')+'"><b>'+('0'+n)+'</b><em>'+['边境','哨所','王庭'][i]+'</em></span>').join('')+'</nav><button class="quiet iconbtn" data-act="rules" aria-label="玩法说明">?</button></header>';
}
function modal(title:string,html:string){
  if(!dialog.open){resumeAfterDialog=run.phase==='battle'&&!paused;if(resumeAfterDialog)togglePause();}
  document.querySelector('#dialog-inner')!.innerHTML='<h2>'+title+'</h2>'+html;
  if(!dialog.open)dialog.showModal();
}
document.querySelector('#close')!.addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{if(resumeAfterDialog&&paused&&run.phase==='battle')togglePause();resumeAfterDialog=false;});
document.addEventListener('unit-info',((e:CustomEvent)=>{const v=e.detail;modal(v.name,'<p>'+units[v.kind as Kind].text+'</p><p>攻击 '+v.atk+'　生命 '+v.hp+'　护盾 '+v.shield+'</p>');}) as EventListener);
const ruleText='<p>每局经过三间商店、三场战斗。至少赢两场即可通关。前两战结束后获得3金币。</p><p>每摇从存活池抽取最多九枚棋子，随机放入九宫格，格内棋子全部点亮。首次点亮召唤，再次点亮攻击。</p><p><b>相邻</b>包括横、竖和斜角。攻击随机锁定一个已召唤的敌方单位。第二摇起，每摇结算完毕后，场上单位全灭的一方落败。双方同时全灭则平局。</p><p>阵亡棋子退出本场。进入下一战时，阵容与单位属性恢复。</p>';
function team(kinds:Kind[]){
  return counts(kinds).map(([k,n])=>'<button class="roster-unit" data-kind="'+k+'">'+art(k)+'<span>'+units[k].name+'</span><b>×'+n+'</b></button>').join('');
}
function landscape(k:Kind,ks:Kind[]){
  return '<div class="diorama"><canvas aria-hidden="true" data-scene="'+k+'"></canvas><div class="party">'+ks.map((n,i)=>art(n,i?'companion':'lead')).join('')+'</div></div>';
}
function shopView(){
  const selectedOffer=run.offers[selected],remain=run.gold-selectedOffer.price;
  app.innerHTML=header()+'<section class="shop"><div class="intro"><div><div class="kicker">商店 '+(run.stage+1)+' / 3</div><h1>'+['边境营地','灰骨营地','王庭营地'][run.stage]+'</h1><p>招募棋子，备战'+encounters[run.stage].name+'。</p></div><div class="purse">'+coin+'<strong>'+run.gold+'</strong><span>金币</span></div></div><div class="offers">'+run.offers.map((o,i)=>{
    const def=units[o.kinds[0]],s=selected===i;
    return '<button class="offer '+(s?'selected ':'')+(o.sold?'sold':'')+'" data-offer="'+i+'" aria-pressed="'+s+'">'+landscape(o.kinds[0],o.kinds)+'<div class="cardbody"><div class="cardhead"><h2>'+o.title+'</h2><span class="price">'+coin+o.price+'</span></div><div class="statline">⚔ '+def.atk+'　<span>'+heart+' '+def.hp+'</span>'+ (o.kinds.length>1?'　·　'+o.kinds.length+' 枚棋子':'')+'</div><p>'+def.text+'</p><div class="cardfoot"><span>'+(o.sold?'已招募':o.kinds.length>1?'成组招募':'单枚招募')+'</span><span>'+(s?'◆ 已选中':'◇ 选择')+'</span></div></div></button>';
  }).join('')+'</div><div class="purchase"><div><small>招募预览</small><b>'+selectedOffer.kinds.map(k=>units[k].name).join(' · ')+'</b><span>阵容 '+run.roster.length+' → '+(run.roster.length+(selectedOffer.sold?0:selectedOffer.kinds.length))+' 枚</span></div><button class="gold" data-act="buy" '+(selectedOffer.sold||remain<0?'disabled':'')+'>'+(selectedOffer.sold?'已招募':remain<0?'还差 '+(-remain)+' 金币':'招募 · '+selectedOffer.price+' 金币')+'</button></div><div class="loadout"><div><h3>我的阵容 <small>'+run.roster.length+' 枚</small></h3><div class="roster">'+team(run.roster)+'</div></div><div><h3>下战对手 <small>'+encounters[run.stage].name+'</small></h3><div class="roster enemy">'+team(encounters[run.stage].units)+'</div></div></div><div class="depart"><span>'+ (run.stage<2?'剩余金币带入下一间商店':'最后一间商店')+'</span><button class="primary" data-act="fight">开始第 '+(run.stage+1)+' 战</button></div></section>';
  for(const c of app.querySelectorAll<HTMLCanvasElement>('canvas[data-scene]'))scenery(c,c.dataset.scene!);
}
function battleShell(){
  const rev=++token;app.innerHTML=header()+'<section class="battle"><div class="battle-title"><div><small class="kicker">第 '+(run.stage+1)+' 战 / 3</small><h1>'+encounters[run.stage].name+'</h1></div><div class="round" id="round"></div></div><div class="commanders"><span id="team0"></span><b>VS</b><span id="team1"></span></div><div class="theatre"><div id="wheel0" class="wheel"></div><div class="arena-wrap"><canvas id="scenery"></canvas><div id="arena" aria-label="自动战斗场面"></div></div><div id="wheel1" class="wheel enemy"></div></div><aside class="feed" aria-live="polite"><b id="phase"></b><span id="message"></span></aside><div class="controls"><button data-act="pause" id="pause"></button><button data-act="step">单步</button><button data-act="speed" id="speed"></button><button data-act="log">战报</button><button data-act="skip">'+(replay?'结束回看':'快速结算')+'</button></div></section>';
  scenery(document.querySelector('#scenery')!,'guard');const host=document.querySelector<HTMLElement>('#arena')!;
  void import('./arena.ts').then(a=>{if(token!==rev)return;arena=a;a.mountArena(host);a.paintArena(currentState(),currentEvent(),speed);});
  paint();
}
function currentEvent(){return pending&&index>0?pending.events[index-1]:undefined;}
function currentState(){return currentEvent()?.state??run.battle!;}
function paint(){
  const e=currentEvent(),b=currentState();
  app.style.setProperty('--orbit-duration', LINK_MS/speed+'ms');
  for(const side of [0,1]){
    const arr=b.boards[side],living=b.units.filter(u=>u.side===side&&u.hp>0),live=living.length;
    document.querySelector('#team'+side)!.textContent=(side?'敌方':'我方')+'在场 '+living.filter(u=>u.field).length;
    document.querySelector('#wheel'+side)!.innerHTML='<h3>'+(side?'敌方轮盘':'我方轮盘')+'<small>存活 '+live+'</small></h3><div class="grid">'+arr.map(id=>{
      const u=b.units.find(n=>n.id===id);
      if(!u)return '<span class="cell empty">·</span>';
      const focused=e?.focus.includes(u.id);
      const effect=focused&&e?.phase==='联动'?'lit orbit ':focused&&e?.phase!=='攻击'?'lit ':'';
      return '<button class="cell '+effect+(u.hp===0?'fallen':'')+'" data-kind="'+u.kind+'" aria-label="'+units[u.kind].name+'">'+art(u.kind)+'</button>';
    }).join('')+'</div>';
  }
  document.querySelector('#round')!.textContent=(replay?'回看 · ':'')+'第 '+b.round+' 摇';
  document.querySelector('#phase')!.textContent=e?.phase??'备战';document.querySelector('#message')!.textContent=e?.text??'双方列阵，准备摇盘。';
  paintControls();
  arena?.paintArena(b,e,speed);
}
function paintControls(){
  document.querySelector('#pause')!.textContent=paused?'继续':'暂停';document.querySelector('#speed')!.textContent=speed+'×';
}
function stopTimer(){window.clearTimeout(timer);}
function schedule(){stopTimer();if(!paused)timer=window.setTimeout(tick,(currentEvent()?.phase==='攻击'?ATTACK_MS:520)/speed);}
function tick(){
  if(!replay&&run.phase!=='battle')return;
  if(!pending){pending=step(run.battle!);index=0;}
  if(index<pending.events.length){index++;paint();schedule();return;}
  if(replay){leaveBattle();render();return;}
  commitRoll(run,pending);pending=undefined;index=0;save();
  if(run.phase==='result'){leaveBattle();render();return;}
  tick();
}
function togglePause(){paused=!paused;if(paused)stopTimer();else schedule();paintControls();}
function leaveBattle(){stopTimer();token++;arena?.closeArena();arena=undefined;replay=false;pending=undefined;index=0;}
function fastFinish(){
  if(replay){leaveBattle();render();return;}
  stopTimer();
  while(run.phase==='battle'){commitRoll(run,pending??step(run.battle!));pending=undefined;}
  leaveBattle();save();render();
}
function results(){
  const end=run.phase==='end',wins=run.results.filter(x=>x==='胜利').length;
  app.innerHTML=header()+'<section class="results"><div class="kicker">'+(end?'远征结束':'第 '+(run.stage+1)+' 战 · '+encounters[run.stage].name)+'</div><h1>'+(end?(wins>=2?'远征通关':'远征结束'):run.results.at(-1))+'</h1><p>'+(end?'三战 '+wins+' 胜':run.battle!.round+' 摇结束　·　我方剩余 '+run.battle!.units.filter(u=>u.side===0&&u.field&&u.hp>0).length+' 名在场单位')+'</p><div class="results-team">'+counts(run.roster).map(([k])=>art(k)).join('')+'</div><div class="score">'+run.results.map((v,i)=>'<div><small>'+encounters[i].name+'</small><b>'+v+'</b></div>').join('')+'</div>'+(!end?'<p>本场阵亡 '+run.battle!.units.filter(u=>u.side===0&&u.hp<=0).length+' 枚　·　下一战阵容恢复</p><div class="review"><button data-act="log">查看战报</button><label>回看 <select id="review-round">'+run.history.map(b=>'<option value="'+b.round+'">第 '+(b.round+1)+' 摇</option>').join('')+'</select></label><button data-act="replay">播放</button></div>':'')+'<button class="primary" data-act="'+(end?'reset':'advance')+'">'+(end?'再来一局':run.stage<2?'进入下一间商店 · +3 金币':'查看本局总结')+'</button></section>';
}
function render(){
  if(run.phase==='shop')shopView();else if(run.phase==='battle'){battleShell();schedule();}else results();
  if(saveWarning)app.insertAdjacentHTML('beforeend','<p>浏览器未能保存，本局进度仅在当前标签页有效。</p>');
}
app.addEventListener('click',event=>{
  const el=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!el||el.disabled)return;
  if(el.dataset.kind){const k=el.dataset.kind as Kind;modal(units[k].name,art(k)+'<p>攻击 '+units[k].atk+'　生命 '+units[k].hp+'</p><p>'+units[k].text+'</p>');return;}
  if(el.dataset.offer!==undefined){selected=Number(el.dataset.offer);shopView();return;}
  switch(el.dataset.act){
    case 'rules':modal('战斗规则',ruleText);break;
    case 'buy':if(buy(run,selected)){save();shopView();}break;
    case 'fight':startBattle(run);paused=false;save();render();break;
    case 'pause':togglePause();break;
    case 'step':paused=true;stopTimer();tick();break;
    case 'speed':speed=speed===1?2:speed===2?4:1;paintControls();schedule();break;
    case 'skip':fastFinish();break;
    case 'advance':advance(run);selected=1;save();render();break;
    case 'reset':run=newRun(getSeed());selected=1;save();render();break;
    case 'log':{
      const lines=[...run.log,...(pending&&!replay?pending.events.slice(0,index).map(e=>'第'+e.state.round+'摇 · '+e.text):[])];
      modal('战斗记录','<ol>'+lines.map(l=>'<li>'+l+'</li>').join('')+'</ol>'+(lines.length?'':'<p>第一摇即将开始。</p>'));break;
    }
    case 'replay':{
      const round=Number(document.querySelector<HTMLSelectElement>('#review-round')!.value);const checkpoint=run.history[round];pending=step(checkpoint,checkpoint.order??'legacy');index=1;replay=true;paused=false;battleShell();schedule();break;
    }
  }
});
document.addEventListener('keydown',e=>{
  if(dialog.open||(!replay&&run.phase!=='battle')||['BUTTON','SELECT'].includes((e.target as HTMLElement).tagName))return;
  if(e.code==='Space'){e.preventDefault();togglePause();}if(e.code==='ArrowRight'&&paused){e.preventDefault();tick();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(run.phase==='battle'||replay)&&!paused)togglePause();});
render();
