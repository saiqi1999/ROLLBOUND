import type {Battle,Moment,step} from './engine.ts';
import type {SpellKind} from './data.ts';
import {COMBAT_TICK_MS,DEATH_MS,EFFECT_MS,type WheelMotion} from './timing.ts';

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

export function playbackFrames({next,events,ticks,outcome}:ReturnType<typeof step>):PlaybackFrame[]{
  if(!ticks.length){
    // A wheel effect can decide a battle before the first combat tick.
    return events.length?[{state:next,moments:events,until:events.length,duration:closingDuration(events)}]:[];
  }
  return ticks.map((tick,index)=>{
    const moments=events.slice(index===0?0:tick.from,tick.until);
    const closing=outcome&&index===ticks.length-1;
    return {state:tick.state,moments,until:tick.until,duration:closing?closingDuration(moments):COMBAT_TICK_MS};
  });
}

export function wheelCues(frame:PlaybackFrame|undefined){
  const cues:{moment:Moment;motion:WheelMotion}[]=[];
  for(const moment of frame?.moments??[]){
    const {phase,spell,action,originRoll,valueTargets,focus}=moment;
    if(!focus.length)continue;
    if(phase==='停盘')cues.push({moment,motion:'draw'});
    else if(spell)cues.push({moment,motion:'cast'});
    else if(action==='blocked')cues.push({moment,motion:'shake'});
    else if((phase==='联动'&&originRoll===frame?.state.round)||
      (valueTargets?.length&&(phase==='召唤'||phase==='阵亡'||phase==='复活')))cues.push({moment,motion:'orbit'});
  }
  return cues;
}

export function frameMessage(frame:PlaybackFrame|undefined){
  const moments=frame?.moments??[];
  const attacks=moments.filter(moment=>moment.action==='attack');
  if(attacks.length>1)return {phase:'攻击',text:attacks.length+' 名单位出手。'};
  const moment=attacks[0]??moments.find(moment=>moment.spell)??
    moments.find(moment=>moment.phase!=='移动'&&moment.phase!=='停盘')??moments[0];
  if(!moment)return frame?{phase:'战斗',text:'单位继续行动。'}:{phase:'备战',text:'双方列阵，准备摇盘。'};
  const prefix=moment.originRoll!==undefined&&moment.originRoll!==frame?.state.round?'第 '+moment.originRoll+' 摇联动 · ':'';
  return {phase:moment.phase,text:prefix+moment.text};
}

export type ActorEffect = SpellKind|'heal'|'empower';
export type ActorFeedback = {
  attack?:true;
  heal?:true;
  hit?:true;
  death?:true;
  revive?:true;
  marked?:true;
  damage:number;
  shield:number;
  values:string[];
  effects:Set<ActorEffect>;
};

export function actorFeedback(moments:Moment[]){
  const actors=new Map<string,ActorFeedback>();
  const feedback=(id:string)=>{
    const existing=actors.get(id);
    if(existing)return existing;
    const cue:ActorFeedback={damage:0,shield:0,values:[],effects:new Set()};
    actors.set(id,cue);
    return cue;
  };
  for(const moment of moments){
    const {source,target,action,spell,value,valueTargets}=moment;
    if(action==='attack'&&source&&target){
      const attacker=feedback(source),victim=feedback(target);
      attacker.attack=true;
      attacker.shield+=moment.shieldGain??0;
      victim.hit=true;
      victim.damage+=moment.damage??0;
      continue;
    }
    if(action==='blocked'||moment.phase==='停盘')continue;
    for(const id of moment.focus)feedback(id).marked=true;
    if(action==='death')for(const id of moment.focus)feedback(id).death=true;
    if(action==='heal'&&source)feedback(source).heal=true;
    if(moment.phase==='复活'&&source)feedback(source).revive=true;
    if(spell==='fireball'&&target)feedback(target).hit=true;
    const effect=spell??(action==='heal'||action==='empower'?action:undefined);
    const recipients=valueTargets??(target?[target]:[]);
    for(const id of recipients){
      const cue=feedback(id);
      if(effect)cue.effects.add(effect);
      if(value)cue.values.push(value);
    }
  }
  return actors;
}
