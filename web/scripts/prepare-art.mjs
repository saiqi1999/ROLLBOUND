import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PNG} from 'pngjs';
const root=fileURLToPath(new URL('../../Assets/Game/Art/Characters(100x100 split)/',import.meta.url));
const dest=fileURLToPath(new URL('../public/art/',import.meta.url));
await mkdir(dest,{recursive:true});
const names={guard:'Knight',archer:'Archer',medic:'Priest',king:'Necromancer',page:'Skeleton',orc:'Orc',bone:'Skeleton Archer'};
const manifest={};
for(const [id,name] of Object.entries(names)){
  manifest[id]={};
  for(const [move,suffix] of Object.entries({idle:'Idle',attack:['medic','bone'].includes(id)?'Attack':'Attack01',death:id==='king'?'DEATH':'Death'})){
    const src=PNG.sync.read(await readFile(path.join(root,name,name+' with shadows',name+'_'+suffix+'.png')));
    if(src.height!==100||src.width%100)throw Error('Invalid sheet: '+name+' '+move);
    const count=src.width/100, frame=80;
    const sheet=new PNG({width:frame*count,height:64});
    for(let i=0;i<count;i++)PNG.bitblt(src,sheet,100*i+10,6,80,64,i*frame,0);
    await writeFile(path.join(dest,id+'-'+move+'.png'),PNG.sync.write(sheet));
    manifest[id][move]=count;
    if(move==='idle'){
      const badge=new PNG({width:40,height:36});
      PNG.bitblt(src,badge,30,26,40,36,0,0);
      await writeFile(path.join(dest,id+'.png'),PNG.sync.write(badge));
    }
  }
}
await writeFile(path.join(dest,'frames.json'),JSON.stringify(manifest));
