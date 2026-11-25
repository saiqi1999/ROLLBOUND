import {encounters,races,unitRaces,type Kind,type SpellKind} from '../data.ts';
import type {Run} from '../engine.ts';
import {magicTags,type TagId} from '../magic-tags.ts';
import {lineupLogging} from '../lineup-client.ts';

const base=import.meta.env.BASE_URL;
export const heart='♥';
export const coin='<i class="coin" aria-hidden="true"></i>';
export const art=(kind:Kind,cls='')=>'<img class="sprite '+cls+'" src="'+base+'art/'+kind+'.png" alt="">';
export const spellArt=(kind:SpellKind,cls='')=>'<img class="sprite '+cls+'" src="'+
  base+(kind==='recruit'?'art/spell-recruit.png':'spells/'+kind+'.png')+'" alt="">';
export const tagArt=(tag:TagId,cls='')=>'<img class="tag-icon '+cls+'" src="'+base+'tags/'+tag+'.png" alt="">';
export const tagBadge=(tag:TagId)=>'<span class="tag-badge" title="'+magicTags[tag].name+'">'+
  tagArt(tag)+'<span class="sr-only">'+magicTags[tag].name+'标签</span></span>';
export const lineupExport=lineupLogging?
  '<a class="lineup-export" href="./api/battle-lineups" download>导出阵容日志</a>':'';

export function unitTags(kind:Kind,temporary=false){
  return '<span class="unit-tags">'+unitRaces(kind).map(race=>races[race]).join(' + ')+
    (temporary?' · 临时':'')+'</span>';
}

export function header(run:Run,view:'route'|'shop'='route'){
  const brand='<div class="brand"><span class="brandmark" aria-hidden="true">◆</span><div><strong>ROLLBOUND</strong>'+
    '<small>轮盘战记</small></div></div>';
  const rules='<button class="quiet iconbtn" data-act="rules" aria-label="玩法说明">?</button>';
  if(view==='shop'){
    return '<header class="shop-header">'+brand+'<div class="shop-hud"><span class="shop-round">第 '+(run.stage+1)+
      ' / '+encounters.length+' 轮</span><span class="purse">'+coin+'<strong id="shop-gold">'+run.gold+
      '</strong><span class="sr-only">金币</span></span></div>'+rules+'</header>';
  }
  const route=encounters.map((encounter,index)=>
    '<span class="'+(index===run.stage?'now':index<run.stage?'past':'')+'" title="'+encounter.name+
    '"'+(run.stage===index?' aria-current="step"':'')+'><b data-total="'+encounters.length+'">0'+(index+1)+
    '</b><em>'+encounter.camp+'</em></span>',
  ).join('');
  return '<header>'+brand+'<nav aria-label="旅程">'+route+'</nav>'+rules+'</header>';
}
