import Phaser from 'phaser';
import {ARENA_ART_WAIT_MS,ATTACK_MS,COMBAT_TICK_MS,DEATH_MS,EFFECT_MS} from './timing.ts';
import {actorFeedback,type ActorFeedback,type ActorEffect,type PlaybackFrame} from './playback.ts';
import {COMBAT,type Point} from './battle/model.ts';
import {clearHitFlash,flashHit} from './hit-flash.ts';
import {units,type Kind} from './data.ts';
import {currentAttack,maxHealth,type Battle,type Unit} from './engine.ts';
const base=import.meta.env.BASE_URL+'art/';
const actions=['idle','walk','attack','death'] as const;
const effectStills={empower:1,fireball:0} as const;
const missingSprite=['ally-marker','enemy-marker'] as const;
const spriteFrame={frameWidth:80,frameHeight:64};
type Pose = 'attack'|'death';
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
  private readonly kinds:Set<Kind>;

  onReady:()=>void;

  constructor(battle:Battle,onReady:()=>void){
    super();
    this.kinds=new Set(battle.units.map(unit=>unit.kind));
    if(this.kinds.has('armoredSkeleton'))this.kinds.add('page');
    this.onReady=onReady;
  }

  preload(){
    const xhrSettings:Phaser.Types.Loader.XHRSettingsObject={responseType:'blob',timeout:ARENA_ART_WAIT_MS};
    for(const kind of this.kinds)for(const move of actions){
      this.load.spritesheet(kind+'-'+move,base+kind+'-'+move+'.png',spriteFrame,xhrSettings);
    }
    for(const fx of Object.keys(effectStills)){
      this.load.spritesheet('fx-'+fx,base+'fx-'+fx+'.png',{frameWidth:100,frameHeight:100},xhrSettings);
    }
  }
  create(){
    const marker=this.make.graphics({x:0,y:0},false);
    for(const side of [0,1] as const){
      marker.clear().fillStyle(0x1c2924).fillRect(30,32,20,21);
      marker.fillStyle(side?0xcc8c87:0x9dbf9e).fillRect(32,34,16,17);
      marker.fillStyle(0xf7e4be).fillRect(35,37,10,2);
      marker.generateTexture(missingSprite[side],spriteFrame.frameWidth,spriteFrame.frameHeight);
    }
    marker.destroy();
    for(const kind of this.kinds)for(const move of actions){
      const key=kind+'-'+move;
      if(!this.textures.exists(key))continue;
      const frames=this.anims.generateFrameNumbers(key);
      if(frames.length)this.anims.create({key,frames,frameRate:move==='idle'?7:move==='walk'?12:16,repeat:move==='idle'||move==='walk'?-1:0});
    }
    for(const fx of Object.keys(effectStills)){
      const key='fx-'+fx;
      if(!this.textures.exists(key))continue;
      const frames=this.anims.generateFrameNumbers(key);
      if(frames.length)this.anims.create({key,frames,duration:EFFECT_MS,repeat:0});
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
        view.sprite.stop().setTexture(...this.idleFrame(unit));
      }
      view.unit=unit;
      const {sprite,ground,root}=view;
      this.moveActor(view,x,y,animate&&!snap);
      sprite.setScale(scale).setFlipX(actor.facing===-1);
      ground.setSize(23*scale,5*scale);
      const marked=cue?.marked&&!cue.death;
      const color=marked?0xf0cf89:unit.side?0xb48283:0x86b69b;
      ground.setStrokeStyle(marked?2:1,color,marked?1:.45);
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
    }else if(!view.pose){
      this.playLocomotion(view,animate);
    }

    if(!cue)return;
    if(cue.hit&&animate)flashHit(sprite);
    for(const effect of cue.effects)this.playEffect(effect,0,3,scale,animate,root);
    const values=cue.damage?['−'+cue.damage,...cue.values]:[...cue.values];
    if(cue.shield)values.push('+'+cue.shield+' 盾');
    if(cue.healing)values.push('+'+cue.healing+' 血');
    values.forEach((value,index)=>{
      const text=this.add.text(0,-18*scale-14*index,value,{
        fontFamily:'sans-serif',fontSize:'13px',color:value.endsWith('盾')?'#acd5f0':value.endsWith('血')?'#b5ecae':'#fff4bd',
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
    if(!this.anims.exists(key)){
      sprite.stop().setTexture(...this.idleFrame(view.unit));
    }else if(animate){
      const duration=pose==='attack'?ATTACK_MS:pose==='death'?DEATH_MS:EFFECT_MS;
      sprite.play({key,duration});
    }else sprite.stop().setTexture(key,Math.min(2,this.textures.get(key).frameTotal-2));
  }

  playLocomotion(view:ActorView,animate:boolean){
    const walk=view.unit.kind+'-walk';
    const [key,frame]=view.walking&&this.anims.exists(walk)?[walk,0]:this.idleFrame(view.unit);
    if(animate&&frame!==undefined)view.sprite.play(key,true);
    else view.sprite.stop().setTexture(key,frame);
  }

  idleFrame(unit:Unit):[string,number?]{
    const key=unit.kind+'-idle';
    return this.anims.exists(key)?[key,0]:[missingSprite[unit.side]];
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
    const sprite=this.add.sprite(0,3,...this.idleFrame(unit)).setOrigin(.5,54/64);
    const root=this.add.container(x,y,[ground,sprite]).setDepth(y);
    const view:ActorView={root,sprite,ground,unit,goal:{x,y},walking:false};
    this.views.set(unit.id,view);
    sprite.setInteractive().on('pointerdown',()=>{
      const current=view.unit;
      document.dispatchEvent(new CustomEvent('unit-info',{
        detail:{
          kind:current.kind,hp:current.hp,maxHp:maxHealth(current),atk:currentAttack(current),shield:current.shield,
          temporary:current.temporary,tag:current.tag,cloneOf:current.cloneOf,
        },
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
    if(!this.anims.exists(key))return;
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
export function mountArena(parent:HTMLElement,battle:Battle,onReady:()=>void){
  scene=new Stage(battle,onReady);
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
