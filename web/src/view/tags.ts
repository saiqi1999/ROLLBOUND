import {SLIME_REMOVAL_GAIN,units} from '../data.ts';
import type {Run} from '../engine.ts';
import {GROWTH_TAG_GAIN,isRegionTag,magicTags,tagCount,tagIds,tagRegions,teamTagGain,type TagId} from '../magic-tags.ts';
import {unitStats,type UnitInstance} from '../shop/model.ts';
import {WHEEL_SIZE} from '../shop/wheel.ts';
import {art,header,heart,tagArt,tagBadge} from './common.ts';

export type TagSelection={tag?:TagId;unitId?:string;notice:string};
export const slimeRemovalBenefit='其余所有单位永久获得 +'+SLIME_REMOVAL_GAIN+'/+'+SLIME_REMOVAL_GAIN+'。';

function regionPreview(tag:TagId){
  if(!isRegionTag(tag))return '';
  const positions:readonly number[]=tagRegions[tag];
  return '<div class="tag-region" role="img" aria-label="'+magicTags[tag].name+'四格">'+
    Array.from({length:WHEEL_SIZE},(_,index)=>'<i'+(positions.includes(index)?' class="active"':'')+'></i>').join('')+
    '</div>';
}

export function tagDetails(tag:TagId){
  return '<div class="tag-details">'+tagArt(tag)+regionPreview(tag)+'<p>'+magicTags[tag].text+'</p></div>';
}

function actionPreview(unit:UnitInstance,tag:TagId,hasAllies:boolean){
  const name=units[unit.kind].name;
  if(tag==='remove'){
    return name+'将离开本局队伍。'+(unit.kind==='slime'&&hasAllies?slimeRemovalBenefit:'');
  }
  const change=name+' · '+(unit.tag?magicTags[unit.tag].name:'无标签')+' → '+magicTags[tag].name;
  if(unit.tag===tag)return name+'已经贴有这枚标签。';
  const stats=unitStats(unit);
  if(tag==='team'){
    const gain=teamTagGain(stats.health);
    return change+'。按当前生命，阵亡时其他在场友方本场 +'+gain+'/+'+gain+'。';
  }
  if(tag==='clone')return change+'。分身入场 '+stats.attack+' 攻 / '+stats.health+' 血。';
  if(tag==='growth')return change+'。本店开战前永久 +'+GROWTH_TAG_GAIN+'/+'+GROWTH_TAG_GAIN+'。';
  return change+'。';
}

export function renderTags(root:HTMLElement,run:Run,selection:TagSelection){
  const {tag,unitId,notice}=selection;
  const selected=run.roster.find(unit=>unit.id===unitId);
  const inventory=tagIds.filter(id=>tagCount(run.tagInventory,id)>0);
  const choices=inventory.map(id=>
    '<button type="button" class="tag-choice" data-select-tag="'+id+'" aria-pressed="'+(id===tag)+'">'+
    tagArt(id)+'<strong>'+magicTags[id].name+'</strong><small>×'+tagCount(run.tagInventory,id)+'</small></button>',
  ).join('');
  const pieces=run.roster.map(unit=>{
    const {id,kind}=unit,{attack,health}=unitStats(unit);
    return '<button type="button" class="tag-unit" data-tag-target="'+id+'" aria-pressed="'+(id===unitId)+'">'+
      art(kind)+'<span class="tag-unit-text"><strong>'+units[kind].name+'</strong>'+
      '<small>⚔ '+attack+'　'+heart+' '+health+'</small>'+
      (unit.tag?'<small class="current-tag">'+magicTags[unit.tag].name+'</small>':'')+'</span>'+
      (unit.tag?tagBadge(unit.tag):'')+'</button>';
  }).join('');
  const ready=tag&&selected&&tagCount(run.tagInventory,tag)>0&&selected.tag!==tag;
  const action=tag==='remove'?'移除棋子':selected?.tag?'覆盖标签':'贴上标签';
  root.innerHTML=header(run)+'<section class="tags-shop"><div class="tags-heading"><h1>打标签</h1>'+
    '<button type="button" class="quiet" data-act="back-shop">返回商店</button></div>'+
    '<div class="tags-layout"><section class="tag-stock"><h2>库存 <small>'+tagCount(run.tagInventory)+' 枚</small></h2>'+
    (choices?'<div class="tag-choices">'+choices+'</div>':'<p class="muted">购买标签后可使用。</p>')+
    (tag?tagDetails(tag):'')+'</section><section><h2>我的阵容 <small>'+run.roster.length+' 名</small></h2>'+
    (pieces?'<div class="tag-roster">'+pieces+'</div>':'<p class="muted">队伍为空。</p>')+'</section></div>'+
    '<p class="tag-notice" role="status">'+notice+'</p>'+
    '<div class="tag-action"><p>'+(tag&&selected?actionPreview(selected,tag,run.roster.length>1):
      inventory.length&&pieces?'选择标签和棋子。':'')+'</p>'+
    '<button type="button" class="'+(tag==='remove'?'remove-confirm':'primary')+'" data-act="apply-tag" '+
    (ready?'':'disabled')+'>'+action+'</button></div></section>';
}
