import Phaser from 'phaser';
import {ATTACK_MS} from './timing.ts';
import {flashHit} from './hit-flash.ts';
import {units, type Kind} from './data.ts';
import {currentAttack,maxHealth,type Battle,type Moment,type Unit} from './engine.ts';
const base=import.meta.env.BASE_URL+'art/';
const actions:Record<Kind,string[]>=Object.fromEntries(
  Object.keys(units).map(k=>[k,k==='medic'?['idle','attack','death','heal']:['idle','attack','death']])
) as Record<Kind,string[]>;
const spellEffects=['heal','empower'] as const;
const SPELL_MS=400;
let scene:Stage|undefined, game:Phaser.Game|undefined, observer:ResizeObserver|undefined, latest:{b:Battle,e:Moment|undefined,speed:number}|undefined;
class Stage extends Phaser.Scene {
  ready=false;
  preload(){
    this.load.json('frames',base+'frames.json');
    for(const [kind,moves] of Object.entries(actions))for(const move of moves){
      this.load.spritesheet(kind+'-'+move,base+kind+'-'+move+'.png',{frameWidth:80,frameHeight:64});
    }
    for(const fx of spellEffects)this.load.spritesheet('fx-'+fx,base+'fx-'+fx+'.png',{frameWidth:100,frameHeight:100});
  }
  create(){
    const frames=this.cache.json.get('frames');
    for(const [k,moves] of Object.entries(actions))for(const move of moves){
      const key=k+'-'+move;
      this.anims.create({key,frames:this.anims.generateFrameNumbers(key,{start:0,end:frames[k][move]-1}),frameRate:move==='idle'?7:16,repeat:move==='idle'?-1:0});
    }
    for(const fx of spellEffects){
      const key='fx-'+fx;
      this.anims.create({key,frames:this.anims.generateFrameNumbers(key,{start:0,end:frames.fx[fx]-1}),duration:SPELL_MS,repeat:0});
    }
    this.ready=true;this.scale.on('resize',()=>{if(latest)this.paint(latest.b,latest.e,latest.speed);});
    if(latest)this.paint(latest.b,latest.e,latest.speed);
  }
  paint(b:Battle,e:Moment|undefined,speed:number){
    if(!this.ready)return;
    this.tweens.killAll();this.children.removeAll(true);
    const {width:w,height:h}=this.scale;
    const combatants=b.units.filter(u=>u.field||
      (e?.action==='attack'&&e.target===u.id)||
      (e?.action==='death'&&e.focus.includes(u.id)));
    const positions=new Map<string,{x:number;y:number}>();
    for(const side of [0,1]){
      const team=combatants.filter(u=>u.side===side);
      const cols=team.length>6?3:2,rows=Math.ceil(team.length/cols)||1;
      team.forEach((u,i)=>{
        const nx=.06+(.38/cols)*(i%cols+.5);
        positions.set(u.id,{x:w*(side?1-nx:nx),y:16+(h-47)*(Math.floor(i/cols)+.59)/rows});
      });
    }
    if(e?.phase==='联动'&&e.focus.length>1){
      const p=positions.get(e.focus[0]),g=this.add.graphics().lineStyle(2,0xeac879,.8);
      if(p)for(const id of e.focus.slice(1)){const q=positions.get(id);if(q)g.lineBetween(p.x,p.y,q.x,q.y);}
    }
    for(const u of combatants){
      const pos=positions.get(u.id)!;
      this.actor(u,pos.x,pos.y,e,w,h,combatants.filter(x=>x.side===u.side).length,speed);
    }
  }
  actor(u:Unit,x:number,y:number,e:Moment|undefined,w:number,h:number,count:number,speed:number){
    const active=e?.focus.includes(u.id);
    const action=e?.action;
    const hit=action==='attack'&&e?.target===u.id;
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scale=Math.max(.8,Math.min(w/(count>6?170:130),h/(Math.ceil(count/(count>6?3:2))*44+20),3.6));
    const marked=active&&e?.action!=='attack';
    const color=marked?0xf0cf89:u.side?0xb48283:0x86b69b;
    this.add.ellipse(x,y+7,23*scale,5*scale,0x0c1413,.5).setStrokeStyle(marked?2:1,color,marked?1:.45);
    let move='idle';
    if(action==='death'&&active)move='death';
    if(e?.source===u.id){
      if(action==='attack')move='attack';
      if(action==='heal')move='heal';
    }
    const key=u.kind+'-'+move;
    const sprite=this.add.sprite(x,y+9,u.kind+'-idle').setOrigin(.5,54/64).setScale(scale).setFlipX(!!u.side);
    if(!reducedMotion){
      if(move==='attack')sprite.play({key,duration:ATTACK_MS/speed});
      else if(move==='heal')sprite.play({key,duration:SPELL_MS/speed});
      else sprite.play(key);
    }
    if(hit)flashHit(sprite,96/speed);
    if(e?.target===u.id&&(action==='heal'||action==='empower')){
      const fxKey='fx-'+action;
      const fx=this.add.sprite(x,y+9,fxKey).setOrigin(.5,.60).setScale(scale);
      if(reducedMotion)fx.setFrame(1);
      else fx.play({key:fxKey,duration:SPELL_MS/speed}).once(Phaser.Animations.Events.ANIMATION_COMPLETE,()=>fx.destroy());
    }
    const attack=currentAttack(u);
    this.drawStats(u,attack,x,y+14,.38*w/(count>6?3:2));
    if(active&&e?.value&&(e.valueTargets?e.valueTargets.includes(u.id):hit||e.phase!=='攻击')){
      this.add.text(x,y-18*scale,e.value,{fontFamily:'sans-serif',fontSize:'13px',color:'#fff4bd',stroke:'#262b26',strokeThickness:3}).setOrigin(.5);
    }
    if(e?.source===u.id&&e.shieldGain){
      this.add.text(x,y-18*scale,'+'+e.shieldGain+' 盾',{fontFamily:'sans-serif',fontSize:'13px',color:'#acd5f0',stroke:'#262b26',strokeThickness:3}).setOrigin(.5);
    }
    const name=units[u.kind as Kind].name;
    sprite.setInteractive().on('pointerdown',()=>document.dispatchEvent(new CustomEvent('unit-info',{detail:{kind:u.kind,name,hp:u.hp,maxHp:maxHealth(u),atk:attack,shield:u.shield}})));
  }
  drawStats(unit:Unit,attack:number,x:number,y:number,spacing:number){
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
    this.add.container(x,y,[icons,hp,atk]).setScale(Math.min(1,(spacing-3)/width));
  }

}
export function mountArena(parent:HTMLElement){
  scene=new Stage();
  game=new Phaser.Game({type:Phaser.CANVAS,parent,transparent:true,pixelArt:true,banner:false,audio:{noAudio:true},scene,scale:{width:parent.clientWidth,height:parent.clientHeight},fps:{target:30}});
  observer=new ResizeObserver(()=>{if(parent.clientWidth&&parent.clientHeight)game?.scale.resize(parent.clientWidth,parent.clientHeight);});observer.observe(parent);
}
export function paintArena(b:Battle,e:Moment|undefined,speed:number){latest={b,e,speed};scene?.paint(b,e,speed);}
export function closeArena(){observer?.disconnect();observer=undefined;game?.destroy(true);game=undefined;scene=undefined;latest=undefined;}
