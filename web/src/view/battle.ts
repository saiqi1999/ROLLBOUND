import {encounters,REQUIRED_WINS} from '../data.ts';
import {earnedRemovalMarker,type Run} from '../engine.ts';
import {tagCount} from '../magic-tags.ts';
import {deployed} from '../battle/unit-state.ts';
import type {Battle} from '../battle/model.ts';
import {scenery} from '../landscape.ts';
import {frameMessage,type PlaybackFrame} from '../playback.ts';
import {COMBAT_TICK_MS} from '../timing.ts';
import {art,header} from './common.ts';

function seconds(battle:Battle){
  return (battle.runtime.tick*COMBAT_TICK_MS/1000).toFixed(1)+' 秒';
}

export function renderBattle(root:HTMLElement,run:Run,replay:boolean){
  root.innerHTML=header(run)+'<section class="battle"><div class="battle-title"><div><small class="kicker">第 '+(run.stage+1)+
    ' 战 / '+encounters.length+'</small><h1>'+encounters[run.stage].name+'</h1></div><span class="round" id="battle-time"></span></div>'+
    '<div class="commanders"><span id="team0"></span><b>VS</b><span id="team1"></span></div>'+
    '<div class="theatre"><div class="arena-wrap"><canvas id="scenery" aria-hidden="true"></canvas>'+
    '<div id="arena" aria-label="自动战斗场面"></div></div></div>'+
    '<aside class="feed" aria-live="polite"><b id="phase"></b><span id="message"></span></aside>'+
    '<div class="controls"><button data-act="pause" id="pause"></button><button data-act="step">单步</button>'+
    '<button data-act="speed" id="speed"></button><button data-act="log">战报</button>'+
    '<button data-act="skip">'+(replay?'结束回看':'快速结算')+'</button></div></section>';
  scenery(root.querySelector('#scenery')!,'guard');
  return root.querySelector<HTMLElement>('#arena')!;
}

export function paintBattle(root:HTMLElement,battle:Battle,frame:PlaybackFrame|undefined,replay:boolean){
  for(const side of [0,1] as const){
    const active=battle.units.filter(unit=>unit.side===side&&deployed(unit)).length;
    root.querySelector('#team'+side)!.textContent=(side?'敌方':'我方')+'在场 '+active+' · 候补 '+battle.reserves[side].length;
  }
  root.querySelector('#battle-time')!.textContent=(replay?'回看 · ':'')+seconds(battle);
  const status=frameMessage(frame),phase=root.querySelector('#phase')!,message=root.querySelector('#message')!;
  if(phase.textContent!==status.phase)phase.textContent=status.phase;
  if(message.textContent!==status.text)message.textContent=status.text;
}

export function renderResult(root:HTMLElement,run:Run){
  const end=run.phase==='end',wins=run.results.filter(result=>result==='胜利').length;
  const lastStage=run.results.length-1,result=run.results.at(-1);
  const nextShop=!end&&run.stage<encounters.length-1;
  const battle=run.battle;
  const title=end?(wins>=REQUIRED_WINS?'远征通关':result+' · 远征结束'):result;
  const summary=end?run.results.length+' 战 '+wins+' 胜':seconds(battle!)+'结束 · 我方剩余 '+
    battle!.units.filter(unit=>unit.side===0&&deployed(unit)).length+' 名在场单位';
  const review=battle&&run.history.length?
    '<p>本场阵亡 '+battle.units.filter(unit=>unit.side===0&&unit.hp<=0).length+' 名</p>'+
    '<div class="review"><button data-act="log">查看战报</button><label>从 <select id="review-window">'+run.history.map((frame,index)=>
      '<option value="'+index+'">'+seconds(frame)+'</option>').join('')+'</select> 回看</label><button data-act="replay">播放</button></div>':'';
  const reward=nextShop&&earnedRemovalMarker(run.stage,result)?
    '<p class="tag-reward">获得 1 枚移除标签 · 当前持有 '+tagCount(run.tagInventory,'remove')+' 枚</p>':'';
  const roster=[...new Set(run.roster.map(unit=>unit.kind))].map(kind=>art(kind)).join('');
  const score=run.results.map((value,index)=>'<div><small>'+encounters[index].name+'</small><b>'+value+'</b></div>').join('');
  root.innerHTML=header(run)+'<section class="results"><div class="kicker">第 '+(lastStage+1)+' 战 · '+encounters[lastStage].name+
    '</div><h1>'+title+'</h1><p>'+summary+'</p><div class="results-team">'+roster+'</div><div class="score">'+score+'</div>'+
    reward+review+'<button class="primary" data-act="'+(end?'reset':'advance')+'">'+
    (end?'再来一局':nextShop?'进入下一间商店 · +'+encounters[run.stage+1].gold+' 金币':'查看本局总结')+'</button></section>';
}
