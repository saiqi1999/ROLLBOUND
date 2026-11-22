import Phaser from 'phaser';
import {ATTACK_MS,COMBAT_TICK_MS,DEATH_MS,EFFECT_MS} from './timing.ts';
import {actorFeedback,type ActorFeedback,type ActorEffect,type PlaybackFrame} from './playback.ts';
import {COMBAT,type Point} from './battle/model.ts';
import {clearHitFlash,flashHit} from './hit-flash.ts';
import {units,hasGuardian,type Kind} from './data.ts';
import {currentAttack,maxHealth,type Battle,type Unit} from './engine.ts';
const base=import.meta.env.BASE_URL+'art/';
const actions:Record<Kind,string[]>=Object.fromEntries(
  Object.keys(units).map(k=>[k,k==='medic'?['idle','walk','attack','death','heal']:['idle','walk','attack','death']])
) as Record<Kind,string[]>;
const effectStills={heal:1,empower:1,fireball:0} as const;
type Pose = 'attack'|'heal'|'death';
type ActorView = {
  root:Phaser.GameObjects.Container;
  sprite:Phaser.GameObjects.Sprite;
  ground:Phaser.GameObjects.Ellipse;
  stats?:Phaser.GameObjects.Container;
  statsKey?:string;
  unit:Unit;
  goal:{x:number;y:number};
  walking:boolean;
  pose?:Pose;
  deathTimer?:Phaser.Time.TimerEvent;
};
let scene:Stage|undefined,game:Phaser.Game|undefined,observer:ResizeObserver|undefined;
let latest:{battle:Battle;frame:PlaybackFrame|undefined}|undefined;
let playing={speed:1,paused:false};

class Stage extends Phaser.Scene {
  ready=false;
  views=new Map<string,ActorView>();
  stillEffects:Phaser.GameObjects.GameObject[]=[];

  onReady:()=>void;

  constructor(onReady:()=>void){
    super();
    this.onReady=onReady;
  }

  preload(){
    this.load.json('frames',base+'frames.json');
    for(const [kind,moves] of Object.entries(actions))for(const move of moves){
      this.load.spritesheet(kind+'-'+move,base+kind+'-'+move+'.png',{frameWidth:80,frameHeight:64});
    }
    for(const fx of Object.keys(effectStills))this.load.spritesheet('fx-'+fx,base+'fx-'+fx+'.png',{frameWidth:100,frameHeight:100});
  }
  create(){
    const frames=this.cache.json.get('frames');
    for(const [k,moves] of Object.entries(actions))for(const move of moves){
      const key=k+'-'+move;
      this.anims.create({key,frames:this.anims.generateFrameNumbers(key,{start:0,end:frames[k][move]-1}),frameRate:move==='idle'?7:move==='walk'?12:16,repeat:move==='idle'||move==='walk'?-1:0});
    }
    for(const fx of Object.keys(effectStills)){
      const key='fx-'+fx;
      this.anims.create({key,frames:this.anims.generateFrameNumbers(key,{start:0,end:frames.fx[fx]-1}),duration:EFFECT_MS,repeat:0});
    }
    this.ready=true;
    this.scale.on('resize',()=>{if(latest)this.paint(latest.battle,latest.frame,true,false);});
    if(latest)this.paint(latest.battle,latest.frame,true);
    this.playback();
    this.onReady();
  }

  playback(){
    if(!this.ready)return;
    this.time.timeScale=playing.speed;
    this.tweens.timeScale=playing.speed;
    this.anims.globalTimeScale=playing.speed;
    if(playing.paused&&!this.scene.isPaused())this.scene.pause();
    if(!playing.paused&&this.scene.isPaused())this.scene.resume();
  }

  paint(battle:Battle,frame:PlaybackFrame|undefined,snap=false,showEffects=true){
    if(!this.ready)return;
    const {width,height}=this.scale;
    const animate=!playing.paused&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scale=Math.max(.75,Math.min(width/370,height/205,2.2));
    const cues=actorFeedback(frame?.moments??[]);
    const project=(position:Point)=>({
      x:14+(width-28)*position.x/COMBAT.width,
      y:25+(height-53)*position.y/COMBAT.height,
    });
    if(showEffects){
      for(const effect of this.stillEffects)effect.destroy();
      this.stillEffects=[];
    }
    for(const unit of battle.units){
      const actor=battle.runtime.actors[unit.id];
      if(!actor)continue;
      const cue=cues.get(unit.id);
      let view=this.views.get(unit.id);
      if(!unit.field&&!cue?.death&&!cue?.hit){
        if(view&&(!animate||(!view.deathTimer&&!(view.pose==='death'&&view.sprite.anims.isPlaying))))this.removeActor(view);
        continue;
      }
      const {x,y}=project(actor.position);
      if(!view)view=this.createActor(unit,x,y);
      if(view.unit.kind!==unit.kind){
        view.pose=undefined;
        view.sprite.stop().setTexture(unit.kind+'-idle',0);
      }
      view.unit=unit;
      const {sprite,ground,root}=view;
      this.moveActor(view,x,y,animate&&!snap);
      sprite.setScale(scale).setFlipX(actor.facing===-1);
      ground.setSize(23*scale,5*scale);
      const guarding=unit.hp>0&&hasGuardian(unit.kind),marked=cue?.marked&&!cue.death;
      const color=marked?0xf0cf89:guarding?0xadd5ef:unit.side?0xb48283:0x86b69b;
      ground.setStrokeStyle(marked||guarding?2:1,color,marked||guarding?1:.45);
      const attack=currentAttack(unit),statsKey=[unit.hp,maxHealth(unit),attack,unit.shield,scale].join('/');
      if(view.statsKey!==statsKey){
        view.stats?.destroy();
        view.stats=this.drawStats(unit,attack,Math.max(30,(width-28)*COMBAT.separation/COMBAT.width+12));
        root.add(view.stats);
        view.statsKey=statsKey;
      }
      if(showEffects){
        this.playActor(view,cue,animate,scale);
      }else if(!sprite.anims.currentAnim&&!view.pose){
        this.playLocomotion(view,animate);
      }
    }
  }

  moveActor(view:ActorView,x:number,y:number,tween:boolean){
    const changed=view.goal.x!==x||view.goal.y!==y;
    view.walking=tween&&changed;
    if(!changed&&tween)return;
    const {root}=view;
    this.tweens.killTweensOf(root);
    view.goal={x,y};
    if(view.walking){
      this.tweens.add({targets:root,x,y,duration:COMBAT_TICK_MS,onUpdate:()=>{root.setDepth(root.y);}});
    }else root.setPosition(x,y).setDepth(y);
  }

  playActor(view:ActorView,cue:ActorFeedback|undefined,animate:boolean,scale:number){
    const {sprite,unit,root}=view;
    if(!animate){
      view.deathTimer?.remove(false);
      view.deathTimer=undefined;
      view.pose=undefined;
      clearHitFlash(sprite);
    }
    if(animate&&view.pose&&!sprite.anims.isPlaying)view.pose=undefined;
    if(cue?.revive&&unit.field&&view.pose==='death')view.pose=undefined;

    // A unit that hit earlier in this tick can finish the swing before falling.
    if(cue?.death&&!unit.field){
      if(cue.attack&&animate){
        this.playPose(view,'attack',true);
        view.deathTimer=this.time.delayedCall(ATTACK_MS/2,()=>{
          view.deathTimer=undefined;
          this.playPose(view,'death',true);
        });
      }else this.playPose(view,'death',animate);
    }else if(cue?.attack){
      this.playPose(view,'attack',animate);
    }else if(cue?.heal){
      this.playPose(view,'heal',animate);
    }else if(!view.pose){
      this.playLocomotion(view,animate);
    }

    if(!cue)return;
    if(cue.hit&&animate)flashHit(sprite);
    for(const effect of cue.effects)this.playEffect(effect,0,3,scale,animate,root);
    const values=cue.damage?['−'+cue.damage,...cue.values]:[...cue.values];
    if(cue.shield)values.push('+'+cue.shield+' 盾');
    values.forEach((value,index)=>{
      const text=this.add.text(0,-18*scale-14*index,value,{
        fontFamily:'sans-serif',fontSize:'13px',color:value.endsWith('盾')?'#acd5f0':'#fff4bd',
        stroke:'#262b26',strokeThickness:3,
      }).setOrigin(.5);
      root.add(text);
      if(animate){
        this.tweens.add({targets:text,y:text.y-7,duration:2*COMBAT_TICK_MS,alpha:.25,onComplete:()=>text.destroy()});
      }else this.stillEffects.push(text);
    });
  }

  playPose(view:ActorView,pose:Pose,animate:boolean){
    const key=view.unit.kind+'-'+pose;
    const {sprite}=view;
    view.pose=pose;
    if(animate){
      const duration=pose==='attack'?ATTACK_MS:pose==='death'?DEATH_MS:EFFECT_MS;
      sprite.play({key,duration});
    }else sprite.stop().setTexture(key,Math.min(2,this.textures.get(key).frameTotal-2));
  }

  playLocomotion(view:ActorView,animate:boolean){
    const key=view.unit.kind+(view.walking?'-walk':'-idle');
    if(animate)view.sprite.play(key,true);
    else view.sprite.stop().setTexture(key,0);
  }

  removeActor(view:ActorView){
    view.deathTimer?.remove(false);
    clearHitFlash(view.sprite);
    this.tweens.killTweensOf(view.root);
    this.views.delete(view.unit.id);
    view.root.destroy();
  }

  createActor(unit:Unit,x:number,y:number){
    const ground=this.add.ellipse(0,1,23,5,0x0c1413,.5);
    const sprite=this.add.sprite(0,3,unit.kind+'-idle').setOrigin(.5,54/64);
    const root=this.add.container(x,y,[ground,sprite]).setDepth(y);
    const view:ActorView={root,sprite,ground,unit,goal:{x,y},walking:false};
    this.views.set(unit.id,view);
    sprite.setInteractive().on('pointerdown',()=>{
      const current=view.unit;
      document.dispatchEvent(new CustomEvent('unit-info',{
        detail:{kind:current.kind,name:units[current.kind].name,hp:current.hp,maxHp:maxHealth(current),atk:currentAttack(current),shield:current.shield,temporary:current.temporary},
      }));
    });
    sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE,()=>{
      const pose=view.pose;
      view.pose=undefined;
      if(pose==='death'&&!view.unit.field)this.removeActor(view);
      else this.playLocomotion(view,true);
    });
    return view;
  }

  playEffect(effect:ActorEffect,x:number,y:number,scale:number,animate:boolean,root?:Phaser.GameObjects.Container){
    const key='fx-'+effect;
    const sprite=this.add.sprite(x,y,key).setDepth(this.scale.height+1).setOrigin(.5,.60).setScale(scale);
    root?.add(sprite);
    if(animate)sprite.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE,()=>sprite.destroy());
    else{
      sprite.setFrame(effectStills[effect]);
      this.stillEffects.push(sprite);
    }
  }

  drawStats(unit:Unit,attack:number,spacing:number){
    const boosted=attack>units[unit.kind].atk;
    const hpColor=unit.hp<maxHealth(unit)?'#ff7077':'#ffffff';
    const attackColor=boosted?'#ffd27d':'#f3ecd9';
    const textStyle={fontFamily:'monospace',fontSize:'12px',stroke:'#24352b',strokeThickness:2};
    const hp=this.add.text(0,0,String(unit.hp),{...textStyle,color:hpColor}).setOrigin(0,.5);
    const atk=this.add.text(0,0,String(attack),{...textStyle,color:attackColor}).setOrigin(0,.5);

    const hpWidth=11+hp.width;
    const swordX=hpWidth+7;
    const width=swordX+10+atk.width;
    const left=-width/2;
    hp.setX(left+11);
    atk.setX(left+swordX+10);
    const icons=this.add.graphics({x:left,y:0});
    icons.fillStyle(0xe8a1a7);
    icons.fillRect(1,-4,3,1);
    icons.fillRect(5,-4,3,1);
    icons.fillRect(0,-3,9,3);
    icons.fillRect(1,0,7,1);
    icons.fillRect(2,1,5,1);
    icons.fillRect(3,2,3,1);
    icons.fillRect(4,3,1,1);
    icons.lineStyle(2,boosted?0xffd27d:0xe1d6bc).lineBetween(swordX-2,3,swordX+5,-4);
    icons.lineStyle(1,0xe1d6bc).lineBetween(swordX-3,0,swordX+1,4);
    if(unit.shield){
      icons.fillStyle(0x91bfdf);
      icons.fillRect(0,7,hpWidth*Math.min(1,unit.shield/12),2);
    }
    return this.add.container(0,10,[icons,hp,atk]).setScale(Math.min(1,(spacing-3)/width));
  }

}
export function mountArena(parent:HTMLElement,onReady:()=>void){
  scene=new Stage(onReady);
  game=new Phaser.Game({type:Phaser.CANVAS,parent,transparent:true,pixelArt:true,banner:false,audio:{noAudio:true},scene,scale:{width:parent.clientWidth,height:parent.clientHeight}});
  observer=new ResizeObserver(()=>{if(parent.clientWidth&&parent.clientHeight)game?.scale.resize(parent.clientWidth,parent.clientHeight);});observer.observe(parent);
}
export function paintArena(battle:Battle,frame:PlaybackFrame|undefined,speed:number,paused:boolean){
  latest={battle,frame};
  setArenaPlayback(speed,paused);
  scene?.paint(battle,frame);
}
export function setArenaPlayback(speed:number,paused:boolean){
  if(playing.speed===speed&&playing.paused===paused)return;
  playing={speed,paused};
  scene?.playback();
}
export function closeArena(){
  observer?.disconnect();observer=undefined;
  game?.destroy(true);game=undefined;scene=undefined;latest=undefined;
}
