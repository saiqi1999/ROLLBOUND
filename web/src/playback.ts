import type {Battle,BattleWindow,Moment} from './battle/model.ts';
import {COMBAT_TICK_MS,DEATH_MS,EFFECT_MS} from './timing.ts';

export type PlaybackFrame = {
  state:Battle;
  moments:Moment[];
  until:number;
  duration:number;
};

function closingDuration(moments:Moment[]){
  if(moments.some(moment=>moment.spell))return EFFECT_MS;
  if(moments.some(moment=>moment.action==='death'))return DEATH_MS;
  return COMBAT_TICK_MS;
}

export function playbackFrames({events,ticks,outcome}:BattleWindow):PlaybackFrame[]{
  return ticks.map((tick,index)=>{
    const moments=events.slice(tick.from,tick.until);
    const closing=outcome&&index===ticks.length-1;
    return {state:tick.state,moments,until:tick.until,duration:tick.opening?EFFECT_MS:closing?closingDuration(moments):COMBAT_TICK_MS};
  });
}

export function frameMessage(frame:PlaybackFrame|undefined){
  const moments=frame?.moments??[];
  const highlight=moments.find(moment=>moment.phase==='补员')??
    moments.find(moment=>moment.phase==='召唤'||moment.phase==='法术'||(moment.phase==='阵亡'&&moment.action==='empower'));
  if(highlight)return {phase:highlight.phase,text:highlight.text};
  const attacks=moments.filter(moment=>moment.action==='attack');
  const followUp=attacks.find(moment=>moment.followUp);
  if(followUp)return {phase:'连击',text:followUp.text};
  const attackers=new Set(attacks.map(moment=>moment.source));
  if(attackers.size>1)return {phase:'攻击',text:attackers.size+' 名单位出手。'};
  if(attacks.length>1)return {phase:'攻击',text:attacks[0].text+' 同时命中 '+attacks.length+' 名敌人。'};
  const moment=attacks[0]??moments.find(moment=>moment.phase!=='移动')??moments[0];
  if(!moment)return frame?{phase:'战斗',text:'单位继续行动。'}:{phase:'备战',text:'双方列阵。'};
  return {phase:moment.phase,text:moment.text};
}

export type ActorEffect = 'fireball'|'empower';
export type ActorFeedback = {
  attack?:true;
  hit?:true;
  death?:true;
  marked?:true;
  damage:number;
  shield:number;
  healing:number;
  values:string[];
  effects:Set<ActorEffect>;
};

export function actorFeedback(moments:Moment[]){
  const actors=new Map<string,ActorFeedback>();
  const feedback=(id:string)=>{
    const existing=actors.get(id);
    if(existing)return existing;
    const cue:ActorFeedback={damage:0,shield:0,healing:0,values:[],effects:new Set()};
    actors.set(id,cue);
    return cue;
  };
  for(const moment of moments){
    const {source,target,action,spell,value,valueTargets}=moment;
    if(action==='attack'&&source&&target){
      const attacker=feedback(source),victim=feedback(target);
      attacker.attack=true;
      attacker.shield+=moment.shieldGain??0;
      attacker.healing+=moment.healing??0;
      if(moment.followUp)attacker.values.push('连击');
      victim.hit=true;
      victim.damage+=moment.damage??0;
      continue;
    }
    for(const id of moment.focus)feedback(id).marked=true;
    if(action==='death')for(const id of moment.focus)feedback(id).death=true;
    if(spell==='fireball'&&target)feedback(target).hit=true;
    const effect=spell??(action==='empower'?action:undefined);
    const recipients=valueTargets??(target?[target]:[]);
    for(const id of recipients){
      const cue=feedback(id);
      if(effect)cue.effects.add(effect);
      if(value)cue.values.push(value);
    }
  }
  return actors;
}
