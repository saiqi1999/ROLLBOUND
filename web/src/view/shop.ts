import {encounters,REFRESH_COST,spells,unitEffectText,units,type Kind} from '../data.ts';
import {canStartBattle,type Run} from '../engine.ts';
import {FIELD_LIMIT} from '../battle/model.ts';
import {GROWTH_TAG_GAIN,magicTags,tagCount,type AppliedTag} from '../magic-tags.ts';
import {scenery} from '../landscape.ts';
import {unitStats,wheelFrame,type UnitInstance} from '../shop/model.ts';
import {canSpin,spinCost} from '../shop/rules.ts';
import {art,coin,header,heart,spellArt,tagArt,tagBadge,unitTags} from './common.ts';
import {renderReels} from './reels.ts';

export type ShopPane='wheel'|'shelf';
function rosterButton(kind:Kind,attack:number,health:number,count:number,id?:string,armor=0,tag?:AppliedTag){
  return '<button class="roster-unit" data-kind="'+kind+'" data-attack="'+attack+'" data-health="'+health+
    '"'+(id?' data-unit-id="'+id+'"':'')+'>'+art(kind)+'<span>'+units[kind].name+
    '<small>⚔ '+attack+'　'+heart+' '+health+(armor?' · 护甲 '+armor:'')+'</small></span>'+
    (count>1?'<b>×'+count+'</b>':'')+(tag?tagBadge(tag):'')+'</button>';
}

function alliedRoster(run:Run){
  const groups=new Map<string,{unit:UnitInstance;count:number}>();
  for(const unit of run.roster){
    const {attack,health}=unitStats(unit);
    const key=[unit.kind,attack,health,unit.startingArmor,unit.evolutionTriggers??0,unit.tag].join(':');
    const group=groups.get(key);
    if(group)group.count++;
    else groups.set(key,{unit,count:1});
  }
  return [...groups.values()].map(({unit,count})=>{
    const {attack,health}=unitStats(unit);
    return rosterButton(unit.kind,attack,health,count,unit.id,unit.startingArmor,unit.tag);
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
  const loaded=run.shop.openingSpells.length;
  if(!owned.length&&!loaded)return '';
  return '<div class="spell-inventory"><h4>法术</h4><div class="roster">'+[...new Set(owned)].map(kind=>
    '<button class="roster-unit" data-spell="'+kind+'">'+spellArt(kind)+'<span>'+spells[kind].name+
    '</span><b>×'+owned.filter(spell=>spell===kind).length+'</b></button>',
  ).join('')+(loaded?'<span class="loaded-spell">'+spellArt('fireball')+'已装填 ×'+loaded+'</span>':'')+'</div></div>';
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
  const tagEntry=root.querySelector<HTMLButtonElement>('[data-act="manage-tags"]')!;
  tagEntry.disabled=spinning;
  tagEntry.textContent='打标签 · '+tagCount(run.tagInventory);
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-shop-pane]'))button.disabled=spinning;
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-buy-index]')){
    const offer=run.shop.offers[Number(button.dataset.buyIndex)];
    const action=offer.type==='unit'?'招募':'购买';
    const state=offer.sold?'sold':run.gold<offer.price?'short':'ready';
    const label=state==='sold'?'已'+action:state==='short'?'金币不足':action;
    const card=button.closest('.offer')!;
    button.disabled=spinning||state!=='ready';
    button.dataset.state=state;
    card.classList.toggle('sold',offer.sold);
    card.querySelector('.offer-effect')!.textContent=offer.type==='unit'?
      unitEffectText(offer.kinds[0],{spellCasts:run.spellCasts}):
      offer.type==='spell'?spells[offer.spell].text:magicTags[offer.tag].text;
    button.innerHTML='<span>'+label+'</span>'+(offer.sold?'':'<span class="offer-cost" aria-hidden="true">'+coin+offer.price+'</span>');
    button.setAttribute('aria-label',offer.sold?label+' '+offer.title:action+' '+offer.title+' · '+offer.price+' 金币');
  }

  const count=run.roster.length;
  const ready=canStartBattle(run);
  const recruitsWaiting=run.pendingRecruits.length;
  const awaitingSpin=recruitsWaiting>0&&canSpin(run);
  const stranded=!ready&&!awaitingSpin&&!run.shop.offers.some(offer=>
    offer.type==='unit'&&!offer.sold&&offer.price<=run.gold)&&run.gold<=REFRESH_COST;
  const fight=root.querySelector<HTMLButtonElement>('[data-act="fight"]')!;
  fight.disabled=spinning||!ready;
  fight.hidden=stranded;
  root.querySelector<HTMLButtonElement>('[data-act="reset"]')!.hidden=!stranded;
  root.querySelector('#departure-note')!.textContent=stranded?'余款不足以招募，可重新开局。':
    ready?'随机首发 '+Math.min(count,FIELD_LIMIT)+' · 候补 '+Math.max(0,count-FIELD_LIMIT):
    awaitingSpin?'摇盘后，待入队单位可出战。':'招募至少 1 名单位后开战。';
  const growing=run.roster.filter(unit=>unit.tag==='growth').length;
  root.querySelector('#departure-growth')!.textContent=growing?
    growing+' 名单位开战前永久 +'+GROWTH_TAG_GAIN+'/+'+GROWTH_TAG_GAIN:'';
  root.querySelector('#shop-roster')!.innerHTML='<h3>我的阵容 <small>'+count+' 名</small></h3>'+
    (count?'<div class="roster">'+alliedRoster(run)+'</div>':'<p class="muted">从货架招募单位。</p>')+spellInventory(run);

  const symbols=count+recruitsWaiting+run.spells.length;
  const offWheel=run.roster.length-run.shop.board.filter(slot=>slot?.type==='unit').length;
  root.querySelector<HTMLButtonElement>('.mobile-shelf-cta')!.hidden=spinning||symbols!==0;
  const cost=spinCost(run.shop.paidSpins);
  const spin=root.querySelector<HTMLButtonElement>('[data-act="spin"]')!;
  spin.disabled=spinning||!canSpin(run);
  spin.innerHTML=spinning?'摇盘中…':'摇盘 <span class="offer-cost">'+coin+cost+' 金</span>';
  root.querySelector<HTMLButtonElement>('[data-act="skip-spin"]')!.hidden=!spinning;
  root.querySelector('#wheel-status')!.textContent=spinning?'从左到右停盘':
    (symbols===0?'招募单位或购买法术后可摇盘。':
      run.gold<cost?'还差 '+(cost-run.gold)+' 金。':'可抽取 '+symbols+' 个符号'+
        (offWheel?' · 盘外 '+offWheel+' 名':'')+' · 下次 '+spinCost(run.shop.paidSpins+1)+' 金')+
    (recruitsWaiting?' · 下次摇盘入队 '+recruitsWaiting+' 名':'');
}

export function paintSpinSummary(root:HTMLElement,run:Run){
  const spin=run.shop.lastSpin;
  root.querySelector('#spin-event')!.textContent=spin?(spin.events.at(-1)?.text??'本次未触发联动。'):
    '招募后实时上盘。摇盘触发联动。';
  const details=root.querySelector<HTMLDetailsElement>('#spin-summary')!;
  details.hidden=!spin;
  details.querySelector('summary')!.textContent=spin?
    '上次停盘 · 定位 '+spin.positioned+' · 补抽 '+spin.fallbackDraws+' · '+spin.events.length+' 项效果':'';
  details.querySelector('ol')!.replaceChildren(...(spin?.events??[]).map(event=>{
    const line=document.createElement('li');
    line.textContent=event.text;
    return line;
  }));
}

export function paintShopBoard(root:HTMLElement,run:Run){
  renderReels(root.querySelector('#reels')!,wheelFrame(run.shop.board,run.roster));
}

export function renderShop(root:HTMLElement,run:Run,pane:ShopPane){
  const encounter=encounters[run.stage];
  const offers=run.shop.offers.map((offer,index)=>{
    const unit=offer.type==='unit'?offer.kinds[0]:undefined;
    const artButton=offer.type==='spell'?'data-spell="'+offer.spell+'"':
      offer.type==='tag'?'data-tag-info="'+offer.tag+'"':'data-kind="'+unit+'"';
    const stats=unit?unitTags(unit)+
      '<span class="offer-stats">⚔ '+units[unit].atk+' <span class="offer-health">'+heart+' '+units[unit].hp+'</span></span>':
      '<span class="unit-tags">'+(offer.type==='tag'?'魔法标签':'一次性法术')+'</span>';
    const portrait=offer.type==='unit'?art(offer.kinds[0],'lead'):
      offer.type==='spell'?spellArt(offer.spell,'lead'):tagArt(offer.tag,'shelf-tag');
    return '<article class="offer" aria-labelledby="offer-title-'+index+'"><button class="offer-art'+(unit?'':' spell-diorama')+
      '" '+artButton+' aria-label="查看 '+offer.title+' 详情">'+(unit?'<canvas aria-hidden="true" data-scene="'+unit+'"></canvas>':'')+
      '<span class="party">'+portrait+'</span></button><div class="cardbody"><h2 id="offer-title-'+index+'">'+offer.title+
      '</h2><div class="offer-meta">'+stats+'</div><p class="offer-effect"></p>'+
      '<button class="gold offer-buy" data-buy-index="'+index+'"></button></div></article>';
  }).join('');
  root.innerHTML=header(run)+'<section class="shop"><div class="intro"><div><div class="kicker">商店 '+(run.stage+1)+
    ' / '+encounters.length+'</div><h1>'+encounter.camp+'营地</h1></div><div class="shop-tools"><div class="purse">'+coin+
    '<strong id="shop-gold"></strong><span>金币</span></div><button class="quiet tag-entry" data-act="manage-tags"></button></div></div>'+
    '<div class="shop-tabs" aria-label="商店区域"><button data-shop-pane="wheel">轮盘</button>'+
    '<button data-shop-pane="shelf">货架</button></div><div class="shop-floor">'+
    '<section class="reel-panel" id="wheel-panel" aria-label="4×4 商店轮盘"><div class="reel-heading"><h2>构筑轮盘</h2>'+
    '</div><div id="reels" class="wheel-board"></div><div class="spin-controls">'+
    '<button class="gold spin-button" data-act="spin" aria-describedby="wheel-status"></button><button data-act="skip-spin" hidden>跳过动画</button>'+
    '<button class="mobile-shelf-cta" data-shop-pane="shelf" hidden>去货架</button>'+
    '<small id="wheel-status"></small></div><p id="spin-event" class="spin-event" role="status"></p>'+
    '<details id="spin-summary" hidden><summary></summary><ol></ol></details></section>'+
    '<section class="shelf-panel" aria-label="商店货架"><div class="shelf-heading"><h2>货架</h2>'+
    '<button class="quiet refresh" data-act="refresh">刷新 · '+REFRESH_COST+' 金</button></div><div class="offers">'+offers+
    '</div><p id="purchase-status" class="sr-only" role="status"></p></section></div>'+
    '<div class="loadout"><div id="shop-roster"></div><div><h3>下战对手 <small>'+encounter.name+
    '</small></h3><div class="roster enemy">'+enemyRoster(run.stage)+'</div></div></div>'+
    '<div class="depart"><div><span id="departure-note"></span><small id="departure-growth"></small></div>'+
    '<button class="primary" data-act="fight" aria-describedby="departure-note departure-growth">'+
    '开始第 '+(run.stage+1)+' 战</button><button class="primary" data-act="reset" hidden>重新开局</button></div></section>';
  changeShopPane(root,pane);
  paintShopBoard(root,run);
  paintShopControls(root,run);
  paintSpinSummary(root,run);
  for(const canvas of root.querySelectorAll<HTMLCanvasElement>('canvas[data-scene]'))scenery(canvas,canvas.dataset.scene!);
}
