import type {Battle,Moment,step} from './engine.ts';
import type {SpellKind} from './data.ts';
import {COMBAT_TICK_MS,DEATH_MS} from './timing.ts';

export type PlaybackFrame = {
  state:Battle;
  moments:Moment[];
  kind:'wheel'|'combat';
  until:number;
  duration:number;
};

export function playbackFrames({events,ticks,outcome}:ReturnType<typeof step>):PlaybackFrame[]{
  const firstTick=ticks[0]?.from??events.length;
  const frames:PlaybackFrame[]=events.slice(0,firstTick).map((moment,i)=>({
    kind:'wheel',state:moment.state,moments:[moment],until:i+1,
    duration:moment.phase==='停盘'?380:520,
  }));
  ticks.forEach((tick,i)=>{
    const moments=events.slice(tick.from,tick.until);
    const finalDeath=outcome&&i===ticks.length-1&&moments.some(moment=>moment.action==='death');
    frames.push({
      kind:'combat',state:tick.state,moments,until:tick.until,
      duration:finalDeath?DEATH_MS:COMBAT_TICK_MS,
    });
  });
  return frames;
}

export function frameMessage(frame:PlaybackFrame|undefined){
  const moments=frame?.moments??[];
  const attacks=moments.filter(moment=>moment.action==='attack');
  if(attacks.length>1)return {phase:'攻击',text:attacks.length+' 名单位出手。'};
  const moment=attacks[0]??moments.find(moment=>moment.phase!=='移动')??moments[0];
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
    if(action==='blocked')continue;
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
