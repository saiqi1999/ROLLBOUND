import Phaser from 'phaser';
import {units, type Kind} from './data.ts';
import type {Battle,Moment,Unit} from './engine.ts';
const base=import.meta.env.BASE_URL+'art/';
let scene:Stage|undefined, game:Phaser.Game|undefined, observer:ResizeObserver|undefined, latest:{b:Battle,e?:Moment}|undefined;
class Stage extends Phaser.Scene {
  ready=false;
  preload(){
    this.load.json('frames',base+'frames.json');
    for(const kind of Object.keys(units))for(const move of ['idle','attack','death']){
      this.load.spritesheet(kind+'-'+move,base+kind+'-'+move+'.png',{frameWidth:80,frameHeight:64});
    }
  }
  create(){
    const frames=this.cache.json.get('frames');
    for(const k of Object.keys(units))for(const move of ['idle','attack','death']){
      const key=k+'-'+move;
      this.anims.create({key,frames:this.anims.generateFrameNumbers(key,{start:0,end:frames[k][move]-1}),frameRate:move==='idle'?7:16,repeat:move==='idle'?-1:0});
    }
    this.ready=true;this.scale.on('resize',()=>{if(latest)this.paint(latest.b,latest.e);});
    if(latest)this.paint(latest.b,latest.e);
  }
  paint(b:Battle,e?:Moment){
    if(!this.ready)return;
    this.tweens.killAll();this.children.removeAll(true);
    const {width:w,height:h}=this.scale;
    const heroes=b.units.filter(u=>u.field||(e?.action==='death'&&e.focus.includes(u.id)));
    const positions=new Map<string,{x:number;y:number}>();
    for(const side of [0,1]){
      const team=heroes.filter(u=>u.side===side);
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
    for(const u of heroes){
      const pos=positions.get(u.id)!;
      this.actor(u,pos.x,pos.y,e,w,h,heroes.filter(x=>x.side===u.side).length);
    }
  }
  actor(u:Unit,x:number,y:number,e:Moment|undefined,w:number,h:number,count:number){
    const active=e?.focus.includes(u.id), hit=e?.target===u.id;
    const scale=Math.max(.8,Math.min(w/(count>6?170:130),h/(Math.ceil(count/(count>6?3:2))*44+20),3.6));
    const color=active?0xf0cf89:u.side?0xb48283:0x86b69b;
    this.add.ellipse(x,y+7,23*scale,5*scale,0x0c1413,.5).setStrokeStyle(active?2:1,color,active?1:.45);
    const move=e?.action==='death'&&active?'death':e?.source===u.id?'attack':'idle';
    const key=u.kind+'-'+move;
    const sprite=this.add.sprite(x,y+9,u.kind+'-idle').setOrigin(.5,54/64).setScale(scale).setFlipX(!!u.side);
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)sprite.play(key);
    if(hit){sprite.setTint(0xffa9a4);this.time.delayedCall(150,()=>{if(sprite.active)sprite.clearTint();});}
    const len=Math.min(43,22*scale),ybar=y+14;
    this.add.rectangle(x,ybar,len,4,0x17221e);
    this.add.rectangle(x-len/2,ybar,len*u.hp/units[u.kind].hp,4,u.side?0xd28d87:0x9acda5).setOrigin(0,.5);
    if(u.shield)this.add.rectangle(x-len/2,ybar+4,len*Math.min(1,u.shield/12),2,0x91bfdf).setOrigin(0,.5);
    if(active&&e?.value&&(hit||e.phase!=='攻击')){
      this.add.text(x,y-18*scale,e.value,{fontFamily:'sans-serif',fontSize:'13px',color:'#fff4bd',stroke:'#262b26',strokeThickness:3}).setOrigin(.5);
    }
    const name=units[u.kind as Kind].name;
    sprite.setInteractive().on('pointerdown',()=>document.dispatchEvent(new CustomEvent('unit-info',{detail:{kind:u.kind,name,hp:u.hp,atk:units[u.kind].atk+u.bonus,shield:u.shield}})));
  }
}
export function mountArena(parent:HTMLElement){
  scene=new Stage();
  game=new Phaser.Game({type:Phaser.CANVAS,parent,transparent:true,pixelArt:true,banner:false,audio:{noAudio:true},scene,scale:{width:parent.clientWidth,height:parent.clientHeight},fps:{target:30}});
  observer=new ResizeObserver(()=>{if(parent.clientWidth&&parent.clientHeight)game?.scale.resize(parent.clientWidth,parent.clientHeight);});observer.observe(parent);
}
export function paintArena(b:Battle,e?:Moment){latest={b,e};scene?.paint(b,e);}
export function closeArena(){observer?.disconnect();observer=undefined;game?.destroy(true);game=undefined;scene=undefined;latest=undefined;}
