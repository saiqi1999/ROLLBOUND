import './style.css';
import {momentDuration,WHEEL_MOTION} from './timing.ts';
import {units,spells,encounters,races,hasGuardian,wizardEntryGain,GOLD_REWARD,REFRESH_COST,REQUIRED_WINS,type Kind,type SpellKind} from './data.ts';
import {newRun,shop,buy,refreshShop,earnedRemovalMarker,removalMarkers,removeUnit,startBattle,advance,step,commitRoll,currentAttack,maxHealth,FIELD_LIMIT,type Run} from './engine.ts';
import {WHEEL_WIDTH} from './battle/wheel.ts';
import {scenery} from './landscape.ts';
import type * as Arena from './arena.ts';
const key='rollbound.trial.v2',base=import.meta.env.BASE_URL+'art/';
const app=document.querySelector<HTMLElement>('#app')!, dialog=document.querySelector<HTMLDialogElement>('#detail')!;
app.style.setProperty('--wheel-width',String(WHEEL_WIDTH));
const getSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
function read():Run{
  try{
    const saved:Run|null=JSON.parse(localStorage.getItem(key)??'null');
    if(saved?.version===2&&Array.isArray(saved.roster)&&saved.roster.every(k=>Object.hasOwn(units,k))&&
       encounters[saved.stage]&&Array.isArray(saved.history))return saved;
  }catch{}
  return newRun(getSeed());
}
let run=read(), selected=0, timer=0, paused=false, speed=1, index=0, pending:ReturnType<typeof step>|undefined;
let startedAt=0,remaining=0;
const wheelMarkup:string[]=[];
let arena:typeof Arena|undefined, token=0,replay=false,resumeAfterDialog=false,saveWarning=false;
let removalOpen=false, removalSelection:number|undefined, removalNotice='';
function save(){try{localStorage.setItem(key,JSON.stringify(run));}catch{saveWarning=true;}}
const art=(k:Kind,cls='',corpse=false)=>'<img class="sprite '+cls+'" src="'+base+k+(corpse?'-corpse':'')+'.png" alt="">';
const spellArt=(kind:SpellKind,cls='')=>'<img class="sprite '+cls+'" src="'+(kind==='recruit'?base+'spell-recruit.png':import.meta.env.BASE_URL+'spells/'+kind+'.png')+'" alt="">';
const heart='♥', coin='<i class="coin" aria-hidden="true"></i>';
const counts=(kinds:Kind[])=>Object.entries(kinds.reduce((a,k)=>(a[k]=(a[k]??0)+1,a),{} as Partial<Record<Kind,number>>)) as [Kind,number][];
const opponentName=(stage:number)=>encounters[stage].name;
function header(){
  return '<header><div class="brand"><span class="brandmark" aria-hidden="true">◆</span><div><strong>ROLLBOUND</strong><small>轮 盘 战 记</small></div></div><nav aria-label="旅程">'+encounters.map((encounter,i)=>
    '<span class="'+(i===run.stage?'now':i<run.stage?'past':'')+'" title="'+opponentName(i)+'"'+(run.stage===i?' aria-current="step"':'')+'><b data-total="'+encounters.length+'">0'+(i+1)+'</b><em>'+encounter.camp+'</em></span>'
  ).join('')+'</nav><button class="quiet iconbtn" data-act="rules" aria-label="玩法说明">?</button></header>';
}
function modal(title:string,html:string){
  if(!dialog.open){resumeAfterDialog=(replay||run.phase==='battle')&&!paused;if(resumeAfterDialog)togglePause();}
  document.querySelector('#dialog-inner')!.innerHTML='<h2>'+title+'</h2>'+html;
  if(!dialog.open)dialog.showModal();
}
document.querySelector('#close')!.addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{if(resumeAfterDialog&&paused&&(replay||run.phase==='battle'))togglePause();resumeAfterDialog=false;});
function unitTags(kind:Kind){
  return '<span class="unit-tags">'+races[units[kind].race]+(hasGuardian(kind)?' · 守护':'')+'</span>';
}
function wizardPreview(kind:Kind){
  if(kind!=='wizard')return '';
  const casts=run.phase==='battle'||replay?currentState().spellCasts:run.spellCasts;
  const gain=wizardEntryGain(casts);
  return '<small class="unit-tags">下次入场增益 +'+gain+'/+'+gain+'</small>';
}
document.addEventListener('unit-info',((e:CustomEvent)=>{
  const v=e.detail;
  modal(v.name,unitTags(v.kind)+'<p>'+units[v.kind as Kind].text+'</p>'+wizardPreview(v.kind)+'<p>攻击 '+v.atk+'　生命 '+v.hp+'/'+v.maxHp+'　护甲 '+v.shield+'</p>');
}) as EventListener);
const ruleText='<p>远征最多经过 '+encounters.length+' 间商店、'+encounters.length+' 场战斗。七战全胜即通关，落败或平局都会结束远征。第 2、4、6 战胜利时各获得 1 个移除标记，每个标记可以在商店移除一枚棋子。进下一间商店时获得 '+GOLD_REWARD+' 金币，每次刷新货架花费 '+REFRESH_COST+' 金币。每组货架随机提供三个单位和一个法术。</p><p>每摇随机抽取最多九枚单位或法术放入九宫格。法术在召唤结算后施放，一经摇出即永久消耗，未摇出的法术带入下一战。摇到候补单位时尝试召唤。已在场的单位会自行走位和普攻，轮盘相邻决定技能。双方各有九个出战位。场满时，摇到的待召唤棋子左右轻晃，继续等待出战。</p><p><b>相邻</b>包括横、竖和斜角。<b>守护</b>会吸引攻击。单位优先随机锁定一名守护敌人，进入射程后出手。生命降至0的单位立即退场，尸体留在轮盘中，占据抽取位。暮王可以消耗相邻尸体。第二摇起，场上单位全灭的一方落败。双方同时全灭则平局。</p><p>种族包括人类、兽人、亡灵和怪物。入场能力按盘面顺序结算，能影响同一摇成功登场的单位。新加入的人类能力提供的属性成长持续一场战斗。护甲与护盾共用数值，优先抵消伤害。下一战所有单位恢复至满血并清空护甲。见习弓手、暮王和魔力强化提供的永久加成跟随各自的棋子，保留至本局结束。</p>';
function rosterStats(kind:Kind,index:number,growth?:Pick<Run,'attackGrowth'|'healthGrowth'>){
  const id='0-'+index;
  return {attack:units[kind].atk+(growth?.attackGrowth?.[id]??0),health:units[kind].hp+(growth?.healthGrowth?.[id]??0)};
}
function team(kinds:Kind[],growth?:Pick<Run,'attackGrowth'|'healthGrowth'>,boost={attack:0,health:0}){
  const groups=new Map<string,{kind:Kind;attack:number;health:number;count:number}>();
  kinds.forEach((kind,index)=>{
    const stats=rosterStats(kind,index,growth);
    const attack=stats.attack+boost.attack;
    const health=stats.health+boost.health;
    const key=kind+':'+attack+':'+health;
    const group=groups.get(key);
    if(group)group.count++;
    else groups.set(key,{kind,attack,health,count:1});
  });
  return [...groups.values()].map(({kind,attack,health,count})=>'<button class="roster-unit" data-kind="'+kind+'" data-attack="'+attack+'" data-health="'+health+'">'+art(kind)+'<span>'+units[kind].name+'</span><span>⚔ '+attack+' '+heart+' '+health+'</span><b>×'+count+'</b></button>').join('');
}
function landscape(k:Kind){
  return '<div class="diorama"><canvas aria-hidden="true" data-scene="'+k+'"></canvas><div class="party">'+art(k,'lead')+'</div></div>';
}
function spellInventory(){
  const owned=run.spells??[];
  if(!owned.length)return '';
  return '<div class="spell-inventory"><h4>待施放法术</h4><div class="roster">'+[...new Set(owned)].map(kind=>
    '<button class="roster-unit" data-spell="'+kind+'">'+spellArt(kind)+'<span>'+spells[kind].name+'</span><b>×'+owned.filter(s=>s===kind).length+'</b></button>'
  ).join('')+'</div></div>';
}
function shopView(){
  const selectedOffer=run.offers[selected],remain=run.gold-selectedOffer.price;
  const encounter=encounters[run.stage];
  const offers=run.offers.map((offer,i)=>{
    const s=selected===i,spell=offer.spell,unit=offer.kinds[0];
    const visual=spell?'<div class="diorama spell-diorama"><div class="party">'+spellArt(spell,'lead')+'</div></div>':landscape(unit);
    const stats=spell?'<span class="unit-tags">一次性法术</span>':unitTags(unit)+'　⚔ '+units[unit].atk+'　'+heart+' '+units[unit].hp;
    const description=spell?spells[spell].text:units[unit].text;
    const state=offer.sold?(spell?'已购买':'已招募'):(spell?'首次摇到时施放':'单枚招募');
    return '<button class="offer '+(s?'selected ':'')+(offer.sold?'sold':'')+'" data-offer="'+i+'" aria-pressed="'+s+'">'+visual+
      '<div class="cardbody"><div class="cardhead"><h2>'+offer.title+'</h2><span class="price">'+coin+offer.price+'</span></div>'+
      '<div class="statline">'+stats+'</div><p>'+description+'</p>'+(spell?'':wizardPreview(unit))+'<div class="cardfoot"><span>'+state+'</span><span>'+(s?'◆ 已选中':'◇ 选择')+'</span></div></div></button>';
  }).join('');
  const purchase=selectedOffer.spell?
    '<small>法术预览</small><b>'+selectedOffer.title+'</b><span>首次摇到时施放并消耗。</span>'
    :'<small>招募预览</small><b>'+selectedOffer.kinds.map(k=>units[k].name).join(' · ')+'</b><span>阵容 '+run.roster.length+' → '+(run.roster.length+(selectedOffer.sold?0:selectedOffer.kinds.length))+' 枚</span>';
  const buyLabel=selectedOffer.spell?'购买':'招募';
  app.innerHTML=header()+'<section class="shop"><div class="intro"><div><div class="kicker">商店 '+(run.stage+1)+' / '+encounters.length+'</div><h1>'+encounter.camp+'营地'+'</h1><p>招募棋子，备战'+encounter.name+'。</p></div><div class="shop-tools"><div class="purse">'+coin+'<strong>'+run.gold+'</strong><span>金币</span></div><button class="quiet refresh" data-act="refresh" '+(run.gold<REFRESH_COST?'disabled':'')+'>刷新 · '+REFRESH_COST+' 金币</button><button class="quiet removal-entry" data-act="manage-removal">移除标记 · '+removalMarkers(run)+'</button></div></div><div class="offers">'+offers+'</div>'
    +'<div class="purchase"><div>'+purchase+'</div><button class="gold" data-act="buy" '+(selectedOffer.sold||remain<0?'disabled':'')+'>'+(selectedOffer.sold?'已'+buyLabel:remain<0?'还差 '+(-remain)+' 金币':buyLabel+' · '+selectedOffer.price+' 金币')+'</button></div><div class="loadout"><div><h3>我的阵容 <small>'+run.roster.length+' 枚</small></h3><div class="roster">'+team(run.roster,run)+'</div>'+spellInventory()+'</div><div><h3>下战对手 <small>'+encounter.name+'</small></h3><div class="roster enemy">'+team(encounter.units,undefined,encounter)+'</div></div></div><div class="depart"><span>'+ (run.stage<encounters.length-1?'剩余金币带入下一间商店':'最后一间商店')+'</span><button class="primary" data-act="fight">开始第 '+(run.stage+1)+' 战</button></div></section>';
  for(const c of app.querySelectorAll<HTMLCanvasElement>('canvas[data-scene]'))scenery(c,c.dataset.scene!);
}
function removalView(){
  const markers=removalMarkers(run);
  const selectedKind=removalSelection===undefined?undefined:run.roster[removalSelection];
  const pieces=run.roster.map((kind,index)=>{
    const stats=rosterStats(kind,index,run);
    return '<button class="removal-unit" data-remove-index="'+index+'" aria-pressed="'+(removalSelection===index)+'" '+(markers?'':'disabled')+'>'
      +art(kind)+'<span><strong>'+units[kind].name+'</strong>'+unitTags(kind)+'<small>⚔ '+stats.attack+'　'+heart+' '+stats.health+'</small></span></button>';
  }).join('');
  app.innerHTML=header()+'<section class="removal-shop"><div class="removal-heading"><div><h1>移除棋子</h1><p>第 2、4、6 战胜利时各获得 1 个移除标记。</p></div>'
    +'<button class="quiet" data-act="back-shop">返回商店</button></div><p class="removal-balance">移除标记 <strong>'+markers+'</strong>　·　阵容 '+run.roster.length+' 枚</p>'
    +(pieces?'<div class="removal-roster">'+pieces+'</div>':'<p>阵容为空，可返回商店招募棋子。</p>')
    +'<div class="removal-action"><p>'+(selectedKind?'将从本局阵容移除 '+units[selectedKind].name+'。':markers&&pieces?'选择要移除的一枚棋子。':'')+'</p>'
    +'<button class="remove-confirm" data-act="confirm-removal" '+(selectedKind&&markers?'':'disabled')+'>移除 · 1 标记</button></div>'
    +'<p class="removal-notice" role="status">'+removalNotice+'</p></section>';
}
function battleShell(){
  const rev=++token;wheelMarkup.length=0;app.innerHTML=header()+'<section class="battle"><div class="battle-title"><div><small class="kicker">第 '+(run.stage+1)+' 战 / '+encounters.length+'</small><h1>'+opponentName(run.stage)+'</h1></div><div class="round" id="round"></div></div><div class="commanders"><span id="team0"></span><b>VS</b><span id="team1"></span></div><div class="theatre"><div id="wheel0" class="wheel"></div><div class="arena-wrap"><canvas id="scenery"></canvas><div id="arena" aria-label="自动战斗场面"></div></div><div id="wheel1" class="wheel enemy"></div></div><aside class="feed" aria-live="polite"><b id="phase"></b><span id="message"></span></aside><div class="controls"><button data-act="pause" id="pause"></button><button data-act="step">单步</button><button data-act="speed" id="speed"></button><button data-act="log">战报</button><button data-act="skip">'+(replay?'结束回看':'快速结算')+'</button></div></section>';
  scenery(document.querySelector('#scenery')!,'guard');const host=document.querySelector<HTMLElement>('#arena')!;
  void import('./arena.ts').then(a=>{if(token!==rev)return;arena=a;a.mountArena(host);a.paintArena(currentState(),currentEvent(),speed,paused);});
  paint();
}
function currentEvent(){return pending&&index>0?pending.events[index-1]:undefined;}
function currentState(){return currentEvent()?.state??run.battle!;}
function paint(){
  const e=currentEvent(),b=currentState();
  const buff=e?.valueTargets?.length&&(e.phase==='召唤'||e.phase==='复活'||e.phase==='阵亡');
  const wheelLink=e?.phase==='联动'&&e.originRoll===b.round;
  const motion=e?.action==='blocked'?'shake':wheelLink||buff?'orbit':undefined;
  if(motion)app.style.setProperty('--wheel-duration',WHEEL_MOTION[motion]/speed+'ms');
  for(const side of [0,1]){
    const arr=b.boards[side],living=b.units.filter(u=>u.side===side&&u.hp>0),live=living.length;
    document.querySelector('#team'+side)!.textContent=(side?'敌方':'我方')+'在场 '+living.filter(u=>u.field).length+'/'+FIELD_LIMIT;
    const markup='<h3>'+(side?'敌方轮盘':'我方轮盘')+'<small>存活 '+live+'</small></h3><div class="grid">'+arr.map(id=>{
      const spell=b.spells?.find(s=>s.id===id);
      if(spell){
        const lit=e?.focus.includes(spell.id)?' lit':'';
        return '<button class="cell'+lit+'" data-spell="'+spell.kind+'" aria-label="'+spells[spell.kind].name+'">'+spellArt(spell.kind)+'</button>';
      }
      const u=b.units.find(n=>n.id===id);
      if(!u)return '<span class="cell empty">·</span>';
      const focused=e?.focus.includes(u.id);
      const effect=focused&&motion?' data-motion="'+motion+'"':'';
      const lit=focused&&e?.phase!=='攻击'&&(e?.phase!=='联动'||wheelLink)&&motion!=='shake'?' lit':'';
      const name=units[u.kind].name;
      if(u.hp===0)return '<span class="cell fallen'+lit+'"'+effect+' role="img" aria-label="'+name+'的尸体">'+art(u.kind,'',true)+'</span>';
      const guarding=u.field&&hasGuardian(u.kind);
      return '<button class="cell'+lit+(guarding?' guardian':'')+'"'+effect+' data-kind="'+u.kind+'" data-attack="'+currentAttack(u)+'" data-health="'+maxHealth(u)+'" aria-label="'+name+(guarding?'，守护':'')+'">'+art(u.kind)+'</button>';
    }).join('')+'</div>';
    if(wheelMarkup[side]!==markup){
      document.querySelector('#wheel'+side)!.innerHTML=markup;
      wheelMarkup[side]=markup;
    }
  }
  document.querySelector('#round')!.textContent=(replay?'回看 · ':'')+'第 '+b.round+' 摇';
  const phase=document.querySelector('#phase')!,message=document.querySelector('#message')!;
  const phaseName=e?.phase??'备战';
  const text=(e?.originRoll!==undefined&&e.originRoll!==b.round?'第 '+e.originRoll+' 摇联动 · ':'')+(e?.text??'双方列阵，准备摇盘。');
  if(phase.textContent!==phaseName)phase.textContent=phaseName;
  if(message.textContent!==text)message.textContent=text;
  paintControls();
  arena?.paintArena(b,e,speed,paused);
}
function paintControls(){
  app.classList.toggle('battle-paused',paused);
  arena?.setArenaPlayback(speed,paused);
  document.querySelector('#pause')!.textContent=paused?'继续':'暂停';document.querySelector('#speed')!.textContent=speed+'×';
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
    remaining=momentDuration(currentEvent());
  }
  if(paused||timer)return;
  startedAt=performance.now();
  timer=window.setTimeout(()=>{
    timer=0;
    remaining=0;
    tick();
  },remaining/speed);
}
function tick(){
  if(!replay&&run.phase!=='battle')return;
  if(!pending){pending=step(run.battle!);index=0;}
  if(index<pending.events.length){index++;paint();schedule(true);return;}
  if(replay){leaveBattle();render();return;}
  commitRoll(run,pending);pending=undefined;index=0;save();
  if(run.phase!=='battle'){leaveBattle();render();return;}
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
  const lastStage=run.results.length-1, result=run.results.at(-1);
  const cleared=wins>=REQUIRED_WINS;
  const nextShop=!end&&run.stage<encounters.length-1;
  const battle=run.battle;
  const title=end?(cleared?'远征通关':result==='胜利'?'远征结束':result+' · 远征结束'):result;
  const summary=end?run.results.length+' 战 '+wins+' 胜':battle!.round+' 摇结束　·　我方剩余 '+battle!.units.filter(u=>u.side===0&&u.field&&u.hp>0).length+' 名在场单位';
  const review=battle&&run.stage===lastStage&&run.history.length
    ?'<p>本场阵亡 '+battle.units.filter(u=>u.side===0&&u.hp<=0).length+' 枚'+(nextShop?'　·　下一战阵容恢复':'')+'</p>'
      +'<div class="review"><button data-act="log">查看战报</button><label>回看 <select id="review-round">'+run.history.map(b=>'<option value="'+b.round+'">第 '+(b.round+1)+' 摇</option>').join('')+'</select></label><button data-act="replay">播放</button></div>'
    :'';
  const reward=nextShop&&earnedRemovalMarker(run.stage,result)?'<p class="removal-reward">获得 1 个移除标记 · 当前持有 '+removalMarkers(run)+' 个</p>':'';
  app.innerHTML=header()+'<section class="results"><div class="kicker">第 '+(lastStage+1)+' 战 · '+opponentName(lastStage)+'</div><h1>'+title+'</h1><p>'+summary+'</p>'
    +'<div class="results-team">'+counts(run.roster).map(([k])=>art(k)).join('')+'</div><div class="score">'+run.results.map((v,i)=>'<div><small>'+opponentName(i)+'</small><b>'+v+'</b></div>').join('')+'</div>'
    +reward+review+'<button class="primary" data-act="'+(end?'reset':'advance')+'">'+(end?'再来一局':nextShop?'进入下一间商店 · +'+GOLD_REWARD+' 金币':'查看本局总结')+'</button></section>';
}
function render(){
  if(run.phase==='shop'){
    if(removalOpen)removalView();else shopView();
  }else if(run.phase==='battle'){battleShell();schedule(true);}else results();
  if(saveWarning)app.insertAdjacentHTML('beforeend','<p>浏览器未能保存，本局进度仅在当前标签页有效。</p>');
}
app.addEventListener('click',event=>{
  const el=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!el||el.disabled)return;
  if(el.dataset.kind){const k=el.dataset.kind as Kind;modal(units[k].name,art(k)+unitTags(k)+'<p>攻击 '+(Number(el.dataset.attack)||units[k].atk)+'　生命 '+(Number(el.dataset.health)||units[k].hp)+'</p><p>'+units[k].text+'</p>'+wizardPreview(k));return;}
  if(el.dataset.spell){
    const kind=el.dataset.spell as SpellKind;
    modal(spells[kind].name,spellArt(kind)+'<p>'+spells[kind].text+'</p><p>首次摇到时施放并消耗。</p>');
    return;
  }
  if(el.dataset.offer!==undefined){selected=Number(el.dataset.offer);shopView();return;}
  if(el.dataset.removeIndex!==undefined&&removalOpen){
    removalSelection=Number(el.dataset.removeIndex);
    removalNotice='';
    render();
    app.querySelector<HTMLElement>('.removal-unit[aria-pressed="true"]')?.focus();
    return;
  }
  switch(el.dataset.act){
    case 'rules':modal('战斗规则',ruleText);break;
    case 'buy':if(buy(run,selected)){save();shopView();}break;
    case 'refresh':if(refreshShop(run)){selected=0;save();shopView();}break;
    case 'manage-removal':
      if(run.phase==='shop'){removalOpen=true;render();app.querySelector<HTMLElement>('[data-act="back-shop"]')?.focus();}
      break;
    case 'back-shop':
      removalOpen=false;removalSelection=undefined;removalNotice='';render();
      app.querySelector<HTMLElement>('[data-act="manage-removal"]')?.focus();
      break;
    case 'confirm-removal':
      if(removalOpen&&removalSelection!==undefined){
        const kind=run.roster[removalSelection];
        if(removeUnit(run,removalSelection)){
          removalSelection=undefined;removalNotice='已移除 '+units[kind].name+'。';
          save();render();
          const next=app.querySelector<HTMLElement>('.removal-unit:not(:disabled)')??app.querySelector<HTMLElement>('[data-act="back-shop"]');
          next?.focus();
        }
      }
      break;
    case 'fight':startBattle(run);paused=false;save();render();break;
    case 'pause':togglePause();break;
    case 'step':paused=true;stopTimer();tick();break;
    case 'speed':stopTimer();speed=speed===1?2:speed===2?4:1;paintControls();schedule();break;
    case 'skip':fastFinish();break;
    case 'advance':advance(run);selected=0;save();render();break;
    case 'reset':run=newRun(getSeed());selected=0;save();render();break;
    case 'log':{
      const lines=[...run.log,...(pending&&!replay?pending.events.slice(0,index).map(e=>'第'+e.state.round+'摇 · '+e.text):[])];
      modal('战斗记录','<ol>'+lines.map(l=>'<li>'+l+'</li>').join('')+'</ol>'+(lines.length?'':'<p>第一摇即将开始。</p>'));break;
    }
    case 'replay':{
      const round=Number(document.querySelector<HTMLSelectElement>('#review-round')!.value);const checkpoint=run.history[round];pending=step(checkpoint);index=1;replay=true;paused=false;battleShell();schedule(true);break;
    }
  }
});
document.addEventListener('keydown',e=>{
  if(dialog.open||(!replay&&run.phase!=='battle')||['BUTTON','SELECT'].includes((e.target as HTMLElement).tagName))return;
  if(e.code==='Space'){e.preventDefault();togglePause();}if(e.code==='ArrowRight'&&paused){e.preventDefault();tick();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(run.phase==='battle'||replay)&&!paused)togglePause();});
render();
