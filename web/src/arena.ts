import Phaser from 'phaser';
import {ATTACK_MS,EFFECT_MS,MOVE_MS} from './timing.ts';
import {COMBAT} from './battle/model.ts';
import {clearHitFlash,flashHit} from './hit-flash.ts';
import {units,hasGuardian,type Kind} from './data.ts';
import {currentAttack,maxHealth,type Battle,type Moment,type Unit} from './engine.ts';
const base=import.meta.env.BASE_URL+'art/';
const actions:Record<Kind,string[]>=Object.fromEntries(
  Object.keys(units).map(k=>[k,k==='medic'?['idle','walk','attack','death','heal']:['idle','walk','attack','death']])
) as Record<Kind,string[]>;
const effectStills={heal:1,empower:1,surge:3,fireball:0,recruit:3} as const;
type ActorView = {
  root:Phaser.GameObjects.Container;
  sprite:Phaser.GameObjects.Sprite;
  ground:Phaser.GameObjects.Ellipse;
  stats?:Phaser.GameObjects.Container;
  statsKey?:string;
  unit:Unit;
};
let scene:Stage|undefined,game:Phaser.Game|undefined,observer:ResizeObserver|undefined;
let latest:{battle:Battle;moment:Moment|undefined}|undefined;
let playing={speed:1,paused:false};

class Stage extends Phaser.Scene {
  ready=false;
  views=new Map<string,ActorView>();
  feedback:Phaser.GameObjects.GameObject[]=[];

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
    this.scale.on('resize',()=>{if(latest)this.paint(latest.battle,latest.moment,true,false);});
    if(latest)this.paint(latest.battle,latest.moment,true);
    this.playback();
  }

  playback(){
    if(!this.ready)return;
    this.tweens.timeScale=playing.speed;
    this.anims.globalTimeScale=playing.speed;
    if(playing.paused&&!this.scene.isPaused())this.scene.pause();
    if(!playing.paused&&this.scene.isPaused())this.scene.resume();
  }

  paint(battle:Battle,moment:Moment|undefined,snap=false,showEffects=true){
    if(!this.ready)return;
    const {width,height}=this.scale;
    const still=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scale=Math.max(.8,Math.min(width/225,height/109,2.75));
    const visible=new Set<string>();
    if(showEffects){
      for(const effect of this.feedback)effect.destroy();
      this.feedback=[];
    }
    for(const unit of battle.units){
      const actor=battle.runtime.actors[unit.id];
      if(!actor)continue;
      const showingDeath=moment?.action==='death'&&moment.focus.includes(unit.id);
      const hit=(moment?.action==='attack'||moment?.spell==='fireball')&&moment.target===unit.id;
      if(!unit.field&&!showingDeath&&!hit)continue;
      visible.add(unit.id);
      const x=14+(width-28)*actor.position.x/COMBAT.width;
      const y=25+(height-53)*actor.position.y/COMBAT.height;
      const fresh=!this.views.has(unit.id);
      const view=this.views.get(unit.id)??this.createActor(unit,x,y);
      view.unit=unit;
      const {root,sprite,ground}=view;
      const moving=Math.hypot(root.x-x,root.y-y)>.05;
      this.tweens.killTweensOf(root);
      if(moving&&moment?.phase==='移动'&&!snap&&!still&&!playing.paused){
        this.tweens.add({
          targets:root,x,y,duration:MOVE_MS,
          onUpdate:()=>{root.setDepth(root.y);},
        });
      }else root.setPosition(x,y).setDepth(y);
      sprite.setScale(scale).setFlipX(actor.facing===-1);
      ground.setSize(23*scale,5*scale);
      const guarding=unit.hp>0&&hasGuardian(unit.kind);
      const active=moment?.focus.includes(unit.id);
      const marked=active&&moment?.action!=='attack'&&moment?.action!=='blocked';
      const color=marked?0xf0cf89:guarding?0xadd5ef:unit.side?0xb48283:0x86b69b;
      ground.setStrokeStyle(marked||guarding?2:1,color,marked||guarding?1:.45);
      const attack=currentAttack(unit),statsKey=[unit.hp,maxHealth(unit),attack,unit.shield,scale].join('/');
      if(view.statsKey!==statsKey){
        view.stats?.destroy();
        view.stats=this.drawStats(unit,attack,Math.max(30,(width-28)*COMBAT.separation/COMBAT.width+12));
        root.add(view.stats);
        view.statsKey=statsKey;
      }
      if(!showEffects&&!fresh)continue;
      let move=showingDeath?'death':moving&&moment?.phase==='移动'?'walk':'idle';
      if(moment?.source===unit.id&&moment.action==='attack')move='attack';
      if(moment?.source===unit.id&&moment.action==='heal')move='heal';
      const key=unit.kind+'-'+move;
      if(still||playing.paused){
        sprite.stop().setTexture(key,move==='idle'||move==='walk'?0:Math.min(2,this.textures.get(key).frameTotal-2));
      }else if(move==='attack'||move==='heal'){
        sprite.play({key,duration:move==='attack'?ATTACK_MS:EFFECT_MS});
      }else sprite.play(key,true);
      if(playing.paused||still)clearHitFlash(sprite);
      else if(hit)flashHit(sprite);
      const effect=moment?.spell??(moment?.action==='heal'||moment?.action==='empower'?moment.action:undefined);
      if(effect&&(moment?.target===unit.id||moment?.valueTargets?.includes(unit.id))){
        this.playEffect(effect,x,y+3,scale);
      }
      if(active&&moment?.value&&(moment.valueTargets?moment.valueTargets.includes(unit.id):hit||moment.phase!=='攻击')){
        this.floatText(x,y-18*scale,moment.value,'#fff4bd');
      }
      if(moment?.source===unit.id&&moment.shieldGain){
        this.floatText(x,y-18*scale,'+'+moment.shieldGain+' 盾','#acd5f0');
      }
    }
    for(const [id,view] of this.views){
      if(visible.has(id))continue;
      this.tweens.killTweensOf(view.root);
      view.root.destroy();
      this.views.delete(id);
    }
    if(showEffects&&moment?.spell==='recruit')this.playEffect('recruit',width*.25,height*.46,scale);
  }

  createActor(unit:Unit,x:number,y:number){
    const ground=this.add.ellipse(0,1,23,5,0x0c1413,.5);
    const sprite=this.add.sprite(0,3,unit.kind+'-idle').setOrigin(.5,54/64);
    const root=this.add.container(x,y,[ground,sprite]).setDepth(y);
    const view:ActorView={root,sprite,ground,unit};
    this.views.set(unit.id,view);
    sprite.setInteractive().on('pointerdown',()=>{
      const current=view.unit;
      document.dispatchEvent(new CustomEvent('unit-info',{
        detail:{kind:current.kind,name:units[current.kind].name,hp:current.hp,maxHp:maxHealth(current),atk:currentAttack(current),shield:current.shield},
      }));
    });
    return view;
  }

  playEffect(effect:keyof typeof effectStills,x:number,y:number,scale:number){
    const key='fx-'+effect;
    const sprite=this.add.sprite(x,y,key).setDepth(this.scale.height+1).setOrigin(.5,.60).setScale(scale);
    this.feedback.push(sprite);
    if(playing.paused||window.matchMedia('(prefers-reduced-motion: reduce)').matches)sprite.setFrame(effectStills[effect]);
    else sprite.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE,()=>sprite.setVisible(false));
  }

  floatText(x:number,y:number,value:string,color:string){
    const text=this.add.text(x,y,value,{fontFamily:'sans-serif',fontSize:'13px',color,stroke:'#262b26',strokeThickness:3});
    this.feedback.push(text.setDepth(this.scale.height+2).setOrigin(.5));
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
export function mountArena(parent:HTMLElement){
  scene=new Stage();
  game=new Phaser.Game({type:Phaser.CANVAS,parent,transparent:true,pixelArt:true,banner:false,audio:{noAudio:true},scene,scale:{width:parent.clientWidth,height:parent.clientHeight},fps:{target:30}});
  observer=new ResizeObserver(()=>{if(parent.clientWidth&&parent.clientHeight)game?.scale.resize(parent.clientWidth,parent.clientHeight);});observer.observe(parent);
}
export function paintArena(battle:Battle,moment:Moment|undefined,speed:number,paused:boolean){
  latest={battle,moment};
  setArenaPlayback(speed,paused);
  scene?.paint(battle,moment);
}
export function setArenaPlayback(speed:number,paused:boolean){
  playing={speed,paused};
  scene?.playback();
}
export function closeArena(){
  observer?.disconnect();observer=undefined;
  game?.destroy(true);game=undefined;scene=undefined;latest=undefined;
}
