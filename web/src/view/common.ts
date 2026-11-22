import {encounters,hasGuardian,races,units,type Kind,type SpellKind} from '../data.ts';
import type {Run} from '../engine.ts';
import {magicTags,type TagId} from '../magic-tags.ts';

const base=import.meta.env.BASE_URL;
export const heart='♥';
export const coin='<i class="coin" aria-hidden="true"></i>';
export const art=(kind:Kind,cls='')=>'<img class="sprite '+cls+'" src="'+base+'art/'+kind+'.png" alt="">';
export const spellArt=(kind:SpellKind,cls='')=>'<img class="sprite '+cls+'" src="'+
  base+(kind==='recruit'?'art/spell-recruit.png':'spells/'+kind+'.png')+'" alt="">';
export const tagArt=(tag:TagId,cls='')=>'<img class="tag-icon '+cls+'" src="'+base+'tags/'+tag+'.png" alt="">';
export const tagBadge=(tag:TagId)=>'<span class="tag-badge" title="'+magicTags[tag].name+'">'+
  tagArt(tag)+'<span class="sr-only">'+magicTags[tag].name+'标签</span></span>';

export function unitTags(kind:Kind,temporary=false){
  return '<span class="unit-tags">'+races[units[kind].race]+(hasGuardian(kind)?' · 守护':'')+
    (temporary?' · 临时':'')+'</span>';
}

export function header(run:Run){
  const route=encounters.map((encounter,index)=>
    '<span class="'+(index===run.stage?'now':index<run.stage?'past':'')+'" title="'+encounter.name+
    '"'+(run.stage===index?' aria-current="step"':'')+'><b data-total="'+encounters.length+'">0'+(index+1)+
    '</b><em>'+encounter.camp+'</em></span>',
  ).join('');
  return '<header><div class="brand"><span class="brandmark" aria-hidden="true">◆</span><div><strong>ROLLBOUND</strong>'+
    '<small>轮盘战记</small></div></div><nav aria-label="旅程">'+route+
    '</nav><button class="quiet iconbtn" data-act="rules" aria-label="玩法说明">?</button></header>';
}
