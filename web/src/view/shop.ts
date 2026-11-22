import {encounters,REFRESH_COST,SLIME_REMOVAL_GAIN,spells,units,wizardEntryGain,type Kind} from '../data.ts';
import {canStartBattle,removalMarkers,type Run} from '../engine.ts';
import {FIELD_LIMIT} from '../battle/model.ts';
import {scenery} from '../landscape.ts';
import {preparedStats,type UnitInstance} from '../shop/model.ts';
import {canSpin,spinCost} from '../shop/rules.ts';
import {art,coin,header,heart,spellArt,unitTags} from './common.ts';
import {emptyBoard,renderReels} from './reels.ts';

export type ShopPane='wheel'|'shelf';
export const slimeRemovalBenefit='其余所有单位永久获得 +'+SLIME_REMOVAL_GAIN+'/+'+SLIME_REMOVAL_GAIN+'。';

export function permanentStats(unit:UnitInstance){
  return {attack:units[unit.kind].atk+unit.gainedAttack,health:units[unit.kind].hp+unit.gainedHealth};
}

function rosterButton(kind:Kind,attack:number,health:number,count:number,id?:string,prepared=''){
  return '<button class="roster-unit" data-kind="'+kind+'" data-attack="'+attack+'" data-health="'+health+
    '"'+(id?' data-unit-id="'+id+'"':'')+'>'+art(kind)+'<span>'+units[kind].name+
    '<small>⚔ '+attack+'　'+heart+' '+health+(prepared?' · '+prepared:'')+'</small></span>'+
    (count>1?'<b>×'+count+'</b>':'')+'</button>';
}

function alliedRoster(run:Run){
  const groups=new Map<string,{unit:UnitInstance;count:number;prepared:string}>();
  for(const unit of run.roster){
    const {attack,health}=permanentStats(unit);
    const bonus=preparedStats(run.shop.preparations,unit.id);
    const medic=run.roster.find(other=>other.id===run.shop.preparations.medicTargets[unit.id]);
    const prepared=[
      ...(bonus.attack||bonus.health?['下战 +'+bonus.attack+'/+'+bonus.health]:[]),
      ...(bonus.shield?[bonus.shield+' 护甲']:[]),
      ...(medic?['治疗'+units[medic.kind].name]:[]),
    ].join(' · ');
    const key=[unit.kind,attack,health,prepared].join(':');
    const group=groups.get(key);
    if(group)group.count++;
    else groups.set(key,{unit,count:1,prepared});
  }
  return [...groups.values()].map(({unit,count,prepared})=>{
    const {attack,health}=permanentStats(unit);
    return rosterButton(unit.kind,attack,health,count,unit.id,prepared);
  }).join('');
}

function enemyRoster(stage:number){
  const encounter=encounters[stage];
  const counts=new Map<Kind,number>();
  for(const kind of encounter.units)counts.set(kind,(counts.get(kind)??0)+1);
  return [...counts].map(([kind,count])=>rosterButton(
    kind,units[kind].atk+encounter.attack,units[kind].hp+encounter.health,count,
  )).join('');
}

function spellInventory(run:Run){
  const owned=run.spells.map(spell=>spell.kind);
  const loaded=run.shop.preparations.openingSpells.length;
  if(!owned.length&&!loaded)return '';
  return '<div class="spell-inventory"><h4>法术</h4><div class="roster">'+[...new Set(owned)].map(kind=>
    '<button class="roster-unit" data-spell="'+kind+'">'+spellArt(kind)+'<span>'+spells[kind].name+
    '</span><b>×'+owned.filter(spell=>spell===kind).length+'</b></button>',
  ).join('')+(loaded?'<span class="loaded-spell">'+spellArt('fireball')+'下战已装填 ×'+loaded+'</span>':'')+'</div></div>';
}

export function changeShopPane(root:HTMLElement,pane:ShopPane){
  root.querySelector<HTMLElement>('.shop-floor')!.dataset.pane=pane;
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-shop-pane]')){
    button.setAttribute('aria-pressed',String(button.dataset.shopPane===pane));
  }
}

export function paintShopControls(root:HTMLElement,run:Run,spinning=false){
  root.querySelector('#shop-gold')!.textContent=String(run.gold);
  root.querySelector<HTMLButtonElement>('[data-act="refresh"]')!.disabled=spinning||run.gold<REFRESH_COST;
  root.querySelector<HTMLButtonElement>('[data-act="manage-removal"]')!.disabled=spinning;
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-shop-pane]'))button.disabled=spinning;
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-buy-index]')){
    const offer=run.shop.offers[Number(button.dataset.buyIndex)];
    const action=offer.spell?'购买':'招募';
    const state=offer.sold?'sold':run.gold<offer.price?'short':'ready';
    const label=state==='sold'?'已'+action:state==='short'?'金币不足':action;
    button.disabled=spinning||state!=='ready';
    button.dataset.state=state;
    button.closest('.offer')!.classList.toggle('sold',offer.sold);
    button.innerHTML='<span>'+label+'</span>'+(offer.sold?'':'<span class="offer-cost" aria-hidden="true">'+coin+offer.price+'</span>');
    button.setAttribute('aria-label',offer.sold?label+' '+offer.title:action+' '+offer.title+' · '+offer.price+' 金币');
  }

  const count=run.roster.length;
  const ready=canStartBattle(run);
  const stranded=!ready&&!run.shop.offers.some(offer=>!offer.spell&&!offer.sold&&offer.price<=run.gold)&&run.gold<=REFRESH_COST;
  const fight=root.querySelector<HTMLButtonElement>('[data-act="fight"]')!;
  fight.disabled=spinning||!ready;
  fight.hidden=stranded;
  root.querySelector<HTMLButtonElement>('[data-act="reset"]')!.hidden=!stranded;
  root.querySelector('#departure-note')!.textContent=stranded?'余款不足以招募，可重新开局。':
    ready?'随机首发 '+Math.min(count,FIELD_LIMIT)+' · 候补 '+Math.max(0,count-FIELD_LIMIT):'招募至少 1 名单位后开战。';
  root.querySelector('#shop-roster')!.innerHTML='<h3>我的阵容 <small>'+count+' 名</small></h3>'+
    (count?'<div class="roster">'+alliedRoster(run)+'</div>':'<p class="muted">从货架招募单位。</p>')+spellInventory(run);

  const symbols=count+run.spells.length;
  root.querySelector<HTMLButtonElement>('.mobile-shelf-cta')!.hidden=spinning||symbols!==0;
  const cost=spinCost(run.shop.paidSpins);
  const spin=root.querySelector<HTMLButtonElement>('[data-act="spin"]')!;
  spin.disabled=spinning||!canSpin(run);
  spin.innerHTML=spinning?'摇盘中…':'摇盘 <span class="offer-cost">'+coin+cost+' 金</span>';
  root.querySelector<HTMLButtonElement>('[data-act="skip-spin"]')!.hidden=!spinning;
  root.querySelector('#wheel-status')!.textContent=spinning?'从左到右停盘':
    symbols===0?'招募单位或购买法术后可摇盘。':
    run.gold<cost?'还差 '+(cost-run.gold)+' 金。':'可抽取 '+symbols+' 个符号 · 下次 '+spinCost(run.shop.paidSpins+1)+' 金';
}

export function paintSpinSummary(root:HTMLElement,run:Run){
  const spin=run.shop.lastSpin;
  root.querySelector('#spin-event')!.textContent=spin?(spin.events.at(-1)?.text??'本次未触发联动。'):
    '停盘后结算相邻棋子和法术。';
  const details=root.querySelector<HTMLDetailsElement>('#spin-summary')!;
  details.hidden=!spin?.events.length;
  details.querySelector('summary')!.textContent='上次停盘 · '+(spin?.events.length??0)+' 项效果';
  details.querySelector('ol')!.replaceChildren(...(spin?.events??[]).map(event=>{
    const line=document.createElement('li');
    line.textContent=event.text;
    return line;
  }));
}

export function renderShop(root:HTMLElement,run:Run,pane:ShopPane){
  const encounter=encounters[run.stage];
  const offers=run.shop.offers.map((offer,index)=>{
    const spell=offer.spell,unit=offer.kinds[0];
    const artButton=spell?'data-spell="'+spell+'"':'data-kind="'+unit+'"';
    const stats=spell?'<span class="unit-tags">一次性法术</span>':unitTags(unit)+
      '<span class="offer-stats">⚔ '+units[unit].atk+' <span class="offer-health">'+heart+' '+units[unit].hp+'</span></span>';
    const portrait=spell?spellArt(spell,'lead'):art(unit,'lead');
    const description=spell?spells[spell].text:units[unit].text;
    const gain=wizardEntryGain(run.spellCasts);
    const wizard=unit==='wizard'?'<small class="unit-tags">当前增益 +'+gain+'/+'+gain+'</small>':'';
    return '<article class="offer" aria-labelledby="offer-title-'+index+'"><button class="offer-art'+(spell?' spell-diorama':'')+
      '" '+artButton+' aria-label="查看 '+offer.title+' 详情">'+(spell?'':'<canvas aria-hidden="true" data-scene="'+unit+'"></canvas>')+
      '<span class="party">'+portrait+'</span></button><div class="cardbody"><h2 id="offer-title-'+index+'">'+offer.title+
      '</h2><div class="offer-meta">'+stats+'</div><p class="offer-effect">'+description+'</p>'+wizard+
      '<button class="gold offer-buy" data-buy-index="'+index+'"></button></div></article>';
  }).join('');
  root.innerHTML=header(run)+'<section class="shop"><div class="intro"><div><div class="kicker">商店 '+(run.stage+1)+
    ' / '+encounters.length+'</div><h1>'+encounter.camp+'营地</h1></div><div class="shop-tools"><div class="purse">'+coin+
    '<strong id="shop-gold"></strong><span>金币</span></div><button class="quiet removal-entry" data-act="manage-removal">'+
    '移除标记 · '+removalMarkers(run)+'</button></div></div>'+
    '<div class="shop-tabs" aria-label="商店区域"><button data-shop-pane="wheel">轮盘</button>'+
    '<button data-shop-pane="shelf">货架</button></div><div class="shop-floor">'+
    '<section class="reel-panel" id="wheel-panel" aria-label="4×4 商店轮盘"><div class="reel-heading"><h2>构筑轮盘</h2>'+
    '<small>横、竖、斜角相邻</small></div><div id="reels" class="wheel-board"></div><div class="spin-controls">'+
    '<button class="gold spin-button" data-act="spin" aria-describedby="wheel-status"></button><button data-act="skip-spin" hidden>跳过动画</button>'+
    '<button class="mobile-shelf-cta" data-shop-pane="shelf" hidden>去货架</button>'+
    '<small id="wheel-status"></small></div><p id="spin-event" class="spin-event" role="status"></p>'+
    '<details id="spin-summary" hidden><summary></summary><ol></ol></details></section>'+
    '<section class="shelf-panel" aria-label="商店货架"><div class="shelf-heading"><h2>货架</h2>'+
    '<button class="quiet refresh" data-act="refresh">刷新 · '+REFRESH_COST+' 金</button></div><div class="offers">'+offers+
    '</div><p id="purchase-status" class="sr-only" role="status"></p></section></div>'+
    '<div class="loadout"><div id="shop-roster"></div><div><h3>下战对手 <small>'+encounter.name+
    '</small></h3><div class="roster enemy">'+enemyRoster(run.stage)+'</div></div></div>'+
    '<div class="depart"><span id="departure-note"></span><button class="primary" data-act="fight" aria-describedby="departure-note">'+
    '开始第 '+(run.stage+1)+' 战</button><button class="primary" data-act="reset" hidden>重新开局</button></div></section>';
  changeShopPane(root,pane);
  renderReels(root.querySelector('#reels')!,run.shop.lastSpin?.settled??emptyBoard);
  paintShopControls(root,run);
  paintSpinSummary(root,run);
  for(const canvas of root.querySelectorAll<HTMLCanvasElement>('canvas[data-scene]'))scenery(canvas,canvas.dataset.scene!);
}

export function renderRemoval(root:HTMLElement,run:Run,selectedId:string|undefined,notice:string){
  const markers=removalMarkers(run);
  const selected=run.roster.find(unit=>unit.id===selectedId);
  const benefit=selected?.kind==='slime'&&run.roster.length>1?slimeRemovalBenefit:'';
  const pieces=run.roster.map(unit=>{
    const {id,kind}=unit,{attack,health}=permanentStats(unit);
    return '<button class="removal-unit" data-remove-id="'+id+'" aria-pressed="'+(selectedId===id)+'" '+(markers?'':'disabled')+'>'+
      art(kind)+'<span><strong>'+units[kind].name+'</strong>'+unitTags(kind)+'<small>⚔ '+attack+'　'+heart+' '+health+'</small></span></button>';
  }).join('');
  root.innerHTML=header(run)+'<section class="removal-shop"><div class="removal-heading"><div><h1>移除棋子</h1>'+
    '<p>第 2、4、6 战胜利时各获得 1 个移除标记。</p></div><button class="quiet" data-act="back-shop">返回商店</button></div>'+
    '<p class="removal-balance">移除标记 <strong>'+markers+'</strong>　·　阵容 '+run.roster.length+' 名</p>'+
    (pieces?'<div class="removal-roster">'+pieces+'</div>':'<p>阵容为空，可返回商店招募棋子。</p>')+
    '<div class="removal-action"><p>'+(selected?'将从本局阵容移除 '+units[selected.kind].name+'。'+benefit:
      markers&&pieces?'选择要移除的棋子。':'')+'</p><button class="remove-confirm" data-act="confirm-removal" '+
    (selected&&markers?'':'disabled')+'>移除 · 1 标记</button></div><p class="removal-notice" role="status">'+notice+'</p></section>';
}
