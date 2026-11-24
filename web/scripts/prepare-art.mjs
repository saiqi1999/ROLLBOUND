import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PNG} from 'pngjs';
const root=fileURLToPath(new URL('../../Assets/Game/Art/Characters(100x100 split)/',import.meta.url));
const dest=fileURLToPath(new URL('../public/art/',import.meta.url));
const bundled=fileURLToPath(new URL('../.generated/',import.meta.url));
await mkdir(dest,{recursive:true});
await mkdir(bundled,{recursive:true});
const names={
  guard:'Knight',archer:'Archer',medic:'Priest',king:'Necromancer',page:'Skeleton',orc:'Orc',bone:'Skeleton Archer',
  soldier:'Soldier',swordsman:'Swordsman',axeman:'Armored Axeman',lancer:'Lancer',templar:'Knight Templar',wizard:'Wizard',
  armoredOrc:'Armored Orc',slime:'Slime',orcRider:'Orc rider',armoredSkeleton:'Armored Skeleton',bat:'Bat',
  greatswordSkeleton:'Greatsword Skeleton',eliteOrc:'Elite Orc',werebear:'Werebear',werewolf:'Werewolf',
  warlock:'Warlock',felSquire:'Black Knight_A',felGuard:'Black Knight_B',
};
const felUnits=new Set(['warlock','felSquire','felGuard']);
const warlockRobe=new Map([
  [0x321717,0x2f193c],[0x52122f,0x492060],[0x6e1d33,0x662984],
  [0x8e2b34,0x80389b],[0x972f34,0x8f47b2],[0xa6483a,0xa35bbf],
  [0x44373d,0x45364f],[0x5b4b53,0x60486e],[0x7b6a6b,0x826192],[0x8d8080,0x9b7bb0],
]);

function applyFelPalette(png,id){
  for(let index=0;index<png.data.length;index+=4){
    const [r,g,b,a]=png.data.subarray(index,index+4);
    if(!a)continue;
    const robe=id==='warlock'?warlockRobe.get(r<<16|g<<8|b):undefined;
    if(robe!==undefined){
      png.data[index]=robe>>16;
      png.data[index+1]=(robe>>8)&255;
      png.data[index+2]=robe&255;
      continue;
    }
    // Remap warm accents while retaining neutral outlines, metal, and ground shadows.
    if(r-g<16||r-b<16||g>r*.89)continue;
    png.data[index]=Math.round(r*.23+g*.58);
    png.data[index+1]=Math.min(255,Math.round(r*.94+g*.15));
    png.data[index+2]=Math.round(r*.24+g*.21+b*.18);
  }
}
const manifest={};
const battleSheets={};
async function writeBattleSheet(key,bytes){
  battleSheets[key]=bytes.toString('base64');
  await writeFile(path.join(dest,key+'.png'),bytes);
}

for(const [id,name] of Object.entries(names)){
  manifest[id]={};
  const idle=id==='bat'?'Flying':'Idle';
  const walk=id==='bat'?'Flying':['lancer','templar'].includes(id)?'Walk01':'Walk';
  const attack=id==='warlock'?'Attack02':['medic','bone'].includes(id)?'Attack':'Attack01';
  for(const [move,suffix] of Object.entries({idle,walk,attack,death:id==='king'?'DEATH':'Death'})){
    const src=PNG.sync.read(await readFile(path.join(root,name,name+' with shadows',name+'_'+suffix+'.png')));
    if(src.height!==100||src.width%100)throw Error('Invalid sheet: '+name+' '+move);
    if(felUnits.has(id))applyFelPalette(src,id);
    const count=src.width/100, frame=80;
    const sheet=new PNG({width:frame*count,height:64});
    for(let i=0;i<count;i++)PNG.bitblt(src,sheet,100*i+10,6,80,64,i*frame,0);
    await writeBattleSheet(id+'-'+move,PNG.sync.write(sheet));
    manifest[id][move]=count;
    if(move==='idle'){
      const height=id==='lancer'||id==='felSquire'?44:36;
      const left=id==='greatswordSkeleton'?24:30;
      const badge=new PNG({width:40,height});
      PNG.bitblt(src,badge,left,62-height,40,height,0,0);
      await writeFile(path.join(dest,id+'.png'),PNG.sync.write(badge));
    }
  }
}
const healFxPath=new URL('../../Assets/Game/Art/Magic(Projectile)/Priest_Heal_effect.png',import.meta.url);
const healFx=PNG.sync.read(await readFile(healFxPath));
if(healFx.height!==100||healFx.width%100)throw Error('Invalid heal effects sheet');
manifest.fx={empower:healFx.width/100};

// Shift the original greens to warm red while retaining each pixel's alpha.
for(let i=0;i<healFx.data.length;i+=4){
  const red=healFx.data[i],green=healFx.data[i+1],blue=healFx.data[i+2];
  healFx.data[i]=Math.max(red,green,blue);
  healFx.data[i+1]=Math.round(red*.48);
  healFx.data[i+2]=Math.round(blue*.49);
}
await writeBattleSheet('fx-empower',PNG.sync.write(healFx));
const fireball=await readFile(new URL('../../Assets/Game/Art/Magic(Projectile)/Wizard_Attack02_Effect.png',import.meta.url));
const {width,height}=PNG.sync.read(fireball);
if(height!==100||width%100)throw Error('Invalid fireball effects sheet');
manifest.fx.fireball=width/100;
await writeBattleSheet('fx-fireball',fireball);
const recruitFx=PNG.sync.read(await readFile(new URL('../../Assets/Game/Art/Magic(Projectile)/Necromancer_Sumon_Effect.png',import.meta.url)));
if(recruitFx.height!==100||recruitFx.width%100)throw Error('Invalid summoning effect sheet');
for(let i=0;i<recruitFx.data.length;i+=4){
  if(!recruitFx.data[i+3])continue;
  const green=recruitFx.data[i+1];
  recruitFx.data[i]=Math.min(255,Math.round(green*1.08+10));
  recruitFx.data[i+1]=Math.round(green*.91);
  recruitFx.data[i+2]=Math.round(recruitFx.data[i+2]*.54);
}

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
await writeFile(path.join(bundled,'arena-sprites.ts'),'export const arenaSprites: Record<string,string> = '+JSON.stringify(battleSheets)+';\n');
