import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PNG} from 'pngjs';
const root=fileURLToPath(new URL('../../Assets/Game/Art/Characters(100x100 split)/',import.meta.url));
const dest=fileURLToPath(new URL('../public/art/',import.meta.url));
await mkdir(dest,{recursive:true});
const names={
  guard:'Knight',archer:'Archer',medic:'Priest',king:'Necromancer',page:'Skeleton',orc:'Orc',bone:'Skeleton Archer',
  soldier:'Soldier',swordsman:'Swordsman',axeman:'Armored Axeman',lancer:'Lancer',templar:'Knight Templar',wizard:'Wizard'
};
const manifest={};
for(const [id,name] of Object.entries(names)){
  manifest[id]={};
  for(const [move,suffix] of Object.entries({idle:'Idle',attack:['medic','bone'].includes(id)?'Attack':'Attack01',death:id==='king'?'DEATH':'Death',...(id==='medic'?{heal:'Heal'}:{})})){
    const src=PNG.sync.read(await readFile(path.join(root,name,name+' with shadows',name+'_'+suffix+'.png')));
    if(src.height!==100||src.width%100)throw Error('Invalid sheet: '+name+' '+move);
    const count=src.width/100, frame=80;
    const sheet=new PNG({width:frame*count,height:64});
    for(let i=0;i<count;i++)PNG.bitblt(src,sheet,100*i+10,6,80,64,i*frame,0);
    await writeFile(path.join(dest,id+'-'+move+'.png'),PNG.sync.write(sheet));
    manifest[id][move]=count;
    if(move==='idle'){
      const height=id==='lancer'?44:36;
      const badge=new PNG({width:40,height});
      PNG.bitblt(src,badge,30,62-height,40,height,0,0);
      await writeFile(path.join(dest,id+'.png'),PNG.sync.write(badge));
    }
    if(move==='death'){
      const badge=new PNG({width:40,height:36});
      // The Necromancer dissolves. Use its last recognizable pose before only particles remain.
      const pose=id==='king'?5:count-1;
      const left=id==='swordsman'?42:id==='lancer'?35:30;
      PNG.bitblt(src,badge,pose*100+left,28,40,36,0,0);
      await writeFile(path.join(dest,id+'-corpse.png'),PNG.sync.write(badge));
    }
  }
}
const healFxPath=new URL('../../Assets/Game/Art/Magic(Projectile)/Priest_Heal_effect.png',import.meta.url);
const healFx=PNG.sync.read(await readFile(healFxPath));
if(healFx.height!==100||healFx.width%100)throw Error('Invalid heal effects sheet');
manifest.fx={heal:healFx.width/100,empower:healFx.width/100};
await writeFile(path.join(dest,'fx-heal.png'),PNG.sync.write(healFx));

// Shift the original greens to warm red while retaining each pixel's alpha.
for(let i=0;i<healFx.data.length;i+=4){
  const red=healFx.data[i],green=healFx.data[i+1],blue=healFx.data[i+2];
  healFx.data[i]=Math.max(red,green,blue);
  healFx.data[i+1]=Math.round(red*.48);
  healFx.data[i+2]=Math.round(blue*.49);
}
await writeFile(path.join(dest,'fx-empower.png'),PNG.sync.write(healFx));
const wizardEffects={surge:'Wizard_Attack01_Effect.png',fireball:'Wizard_Attack02_Effect.png'};
for(const [kind,file] of Object.entries(wizardEffects)){
  const bytes=await readFile(new URL('../../Assets/Game/Art/Magic(Projectile)/'+file,import.meta.url));
  const {width,height}=PNG.sync.read(bytes);
  if(height!==100||width%100)throw Error('Invalid spell effects sheet: '+file);
  manifest.fx[kind]=width/100;
  await writeFile(path.join(dest,'fx-'+kind+'.png'),bytes);
}
const recruitFx=PNG.sync.read(await readFile(new URL('../../Assets/Game/Art/Magic(Projectile)/Necromancer_Sumon_Effect.png',import.meta.url)));
if(recruitFx.height!==100||recruitFx.width%100)throw Error('Invalid summoning effect sheet');
manifest.fx.recruit=recruitFx.width/100;
for(let i=0;i<recruitFx.data.length;i+=4){
  if(!recruitFx.data[i+3])continue;
  const green=recruitFx.data[i+1];
  recruitFx.data[i]=Math.min(255,Math.round(green*1.08+10));
  recruitFx.data[i+1]=Math.round(green*.91);
  recruitFx.data[i+2]=Math.round(recruitFx.data[i+2]*.54);
}
await writeFile(path.join(dest,'fx-recruit.png'),PNG.sync.write(recruitFx));

// Match the other spell badges with a 20×20 backdrop and an original frame.
const recruitBadge=new PNG({width:40,height:36});
for(let y=14;y<34;y++){
  for(let x=10;x<30;x++)recruitBadge.data.set([74,60,34,255],(y*40+x)*4);
}
const circle={x:336,y:50,width:32,height:13};
for(let y=0;y<7;y++){
  for(let x=0;x<18;x++){
    const sourceX=circle.x+Math.floor((x+.5)*circle.width/18);
    const sourceY=circle.y+Math.floor((y+.5)*circle.height/7);
    const start=(sourceY*recruitFx.width+sourceX)*4;
    if(recruitFx.data[start+3])recruitBadge.data.set(recruitFx.data.subarray(start,start+4),((y+20)*40+x+11)*4);
  }
}
await writeFile(path.join(dest,'spell-recruit.png'),PNG.sync.write(recruitBadge));
await writeFile(path.join(dest,'frames.json'),JSON.stringify(manifest));
