import {encounters,REFRESH_COST,spells,unitEffectText,units,type Kind} from '../data.ts';
import {canStartBattle,type Run} from '../engine.ts';
import {magicTags,tagCount,tagIds,type AppliedTag} from '../magic-tags.ts';
import {mirrorLineup,opponentName} from '../mirror-lineups.ts';
import {unitStats,wheelFrame,type UnitInstance} from '../shop/model.ts';
import {canSpin,spinCost} from '../shop/rules.ts';
import {art,coin,header,heart,lineupExport,spellArt,tagArt,tagBadge,unitTags} from './common.ts';
import {renderReels} from './reels.ts';
import './shop.css';

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
    const key=[unit.kind,attack,health,unit.startingArmor,unit.tag].join(':');
    const group=groups.get(key);
    if(group)group.count++;
    else groups.set(key,{unit,count:1});
  }
  return [...groups.values()].map(({unit,count})=>{
    const {attack,health}=unitStats(unit);
    return rosterButton(unit.kind,attack,health,count,unit.id,unit.startingArmor,unit.tag);
  }).join('');
}

function enemyRoster(run:Run){
  const mirror=mirrorLineup(run);
  if(mirror)return [...mirror.starters,...mirror.reserves].map(unit=>
    rosterButton(unit.kind,unit.atk,unit.hp,1,undefined,unit.armor,unit.tag),
  ).join('');
  const encounter=encounters[run.stage];
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

function paintHeldTags(root:HTMLElement,run:Run,spinning:boolean){
  const shelf=root.querySelector<HTMLElement>('#held-tags')!;
  const scrollLeft=shelf.scrollLeft;
  const items=tagIds.flatMap(tag=>{
    const count=tagCount(run.tagInventory,tag);
    if(!count)return [];
    const name=magicTags[tag].name;
    return '<button type="button" class="held-tag" data-act="manage-tags" data-held-tag="'+tag+
      '" aria-label="使用'+name+'标签，持有 '+count+' 枚"'+(spinning?' disabled':'')+'>'+tagArt(tag)+
      '<span>'+name+'</span><b aria-hidden="true">×'+count+'</b></button>';
  });
  shelf.innerHTML=items.join('')||'<span class="tag-shelf-empty">暂无</span>';
  shelf.scrollLeft=scrollLeft;
}

export function paintShopControls(root:HTMLElement,run:Run,spinning=false){
  root.querySelector('#shop-gold')!.textContent=String(run.gold);
  root.querySelector<HTMLButtonElement>('[data-act="refresh"]')!.disabled=spinning||run.gold<REFRESH_COST;
  paintHeldTags(root,run,spinning);
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
  const stranded=!ready&&!run.shop.offers.some(offer=>
    offer.type==='unit'&&!offer.sold&&offer.price<=run.gold)&&run.gold<=REFRESH_COST;
  const fight=root.querySelector<HTMLButtonElement>('[data-act="fight"]')!;
  fight.disabled=spinning||!ready;
  fight.hidden=stranded;
  fight.innerHTML='<span>开始第 '+(run.stage+1)+' 战</span>'+(ready?'':'<small>先招募单位</small>');
  const reset=root.querySelector<HTMLButtonElement>('[data-act="reset"]')!;
  reset.hidden=!stranded;
  reset.disabled=spinning;
  root.querySelector('#roster-count')!.textContent=count+' 名';
  root.querySelector('#shop-roster')!.innerHTML=
    (count?'<div class="roster">'+alliedRoster(run)+'</div>':'<p class="muted">暂无单位</p>')+
    (recruitsWaiting?'<p class="muted">'+recruitsWaiting+' 名将在下次摇盘或开战时入队。</p>':'')+
    spellInventory(run)+lineupExport;

  const symbols=count+recruitsWaiting+run.spells.length;
  const cost=spinCost(run.shop.paidSpins);
  const spin=root.querySelector<HTMLButtonElement>('[data-act="spin"]')!;
  spin.disabled=spinning||!canSpin(run);
  spin.hidden=spinning;
  spin.innerHTML='<span>摇盘</span>'+
    '<span class="offer-cost">'+coin+cost+' 金</span>';
  root.querySelector<HTMLButtonElement>('[data-act="skip-spin"]')!.hidden=!spinning;
  root.querySelector('#wheel-status')!.textContent=symbols===0?'招募单位或购买法术后可摇盘。':
    run.gold<cost?'还差 '+(cost-run.gold)+' 金。':'';
}

export function paintSpinSummary(root:HTMLElement,run:Run){
  const spin=run.shop.lastSpin;
  root.querySelector('#spin-event')!.textContent=spin?(spin.events.at(-1)?.text??'本次未触发联动。'):'';
  const details=root.querySelector<HTMLDetailsElement>('#spin-summary')!;
  details.hidden=!spin?.events.length;
  details.querySelector('ol')!.replaceChildren(...(spin?.events??[]).map(event=>{
    const line=document.createElement('li');
    line.textContent=event.text;
    return line;
  }));
}

export function paintShopBoard(root:HTMLElement,run:Run){
  renderReels(root.querySelector('#reels')!,wheelFrame(run.shop.board,run.roster));
}

export function paintShopOpponent(root:HTMLElement,run:Run){
  const title=root.querySelector('#shop-enemy-name'),roster=root.querySelector('#shop-enemy');
  if(title&&roster){
    title.textContent=opponentName(run);
    roster.innerHTML=enemyRoster(run);
  }
}

export function renderShop(root:HTMLElement,run:Run){
  const offers=run.shop.offers.map((offer,index)=>{
    const unit=offer.type==='unit'?offer.kinds[0]:undefined;
    const artButton=offer.type==='spell'?'data-spell="'+offer.spell+'"':
      offer.type==='tag'?'data-tag-info="'+offer.tag+'"':'data-kind="'+unit+'"';
    const stats=unit?'<span class="offer-stats">⚔ '+units[unit].atk+
      ' <span class="offer-health">'+heart+' '+units[unit].hp+'</span></span>':
      '<span class="offer-type">'+(offer.type==='tag'?'魔法标签':'法术')+'</span>';
    const portrait=offer.type==='unit'?art(offer.kinds[0],'lead'):
      offer.type==='spell'?spellArt(offer.spell,'lead'):tagArt(offer.tag,'shelf-tag');
    const titleId='offer-title-'+index;
    return '<article class="offer" aria-labelledby="'+titleId+'">'+
      '<button type="button" class="offer-art" '+artButton+' aria-label="查看 '+offer.title+' 详情">'+
      '<span class="party">'+portrait+'</span></button>'+
      '<div class="offer-copy"><h3 id="'+titleId+'">'+offer.title+'</h3>'+stats+'</div>'+
      '<div class="offer-preview">'+(unit?unitTags(unit):'')+'<p class="offer-effect"></p></div>'+
      '<button type="button" class="gold offer-buy" data-buy-index="'+index+'"></button></article>';
  }).join('');
  root.innerHTML=header(run,'shop')+'<section class="shop" aria-label="商店"><div class="shop-floor">'+
    '<div class="shop-actions" role="group" aria-label="回合操作">'+
    '<button class="primary fight-button" data-act="fight"></button>'+
    '<button class="primary fight-button" data-act="reset" hidden><span>重新开局</span><small>金币不足以招募</small></button></div>'+
    '<section class="reel-panel" id="wheel-panel" aria-label="4×4 商店轮盘"><div id="reels" class="wheel-board"></div>'+
    '<div class="spin-controls"><button class="gold spin-button" data-act="spin" aria-describedby="wheel-status"></button>'+
    '<button class="spin-button skip-button" data-act="skip-spin" hidden>跳过动画</button>'+
    '<small id="wheel-status" class="sr-only"></small></div></section>'+
    '<p id="spin-event" class="spin-event" role="status"></p>'+
    '<section class="shelf-panel" aria-label="商店商品"><div class="offers">'+offers+'</div>'+
    '<button class="refresh" data-act="refresh"><span class="refresh-copy"><span>刷新商品</span>'+
    '<span class="offer-cost">'+coin+REFRESH_COST+' 金</span></span></button>'+
    '<p id="purchase-status" class="sr-only" role="status"></p></section>'+
    '<section class="tag-shelf" aria-labelledby="tag-shelf-title"><h2 id="tag-shelf-title">标签架</h2>'+
    '<div id="held-tags" class="held-tags"></div></section></div>'+
    '<div class="shop-details"><details><summary>我的阵容 <small id="roster-count"></small></summary>'+
    '<div id="shop-roster"></div></details><details><summary>下战对手 <small id="shop-enemy-name"></small>'+
    '</summary><div class="roster enemy" id="shop-enemy"></div></details>'+
    '<details id="spin-summary" hidden><summary>停盘记录</summary><ol></ol></details></div></section>';
  paintShopBoard(root,run);
  paintShopOpponent(root,run);
  paintShopControls(root,run);
  paintSpinSummary(root,run);
}
