import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../../',import.meta.url));
const client=path.join(root,'web','dist');
const output=path.join(root,'dist');
const types={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png',
};

async function readAssets(directory,relative=''){
  const assets=[];
  for(const item of await readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,item.name);
    const key=relative+item.name;
    if(item.isDirectory())assets.push(...await readAssets(file,key+'/'));
    else if(item.isFile()&&types[path.extname(file)])assets.push([
      key,[types[path.extname(file)],(await readFile(file)).toString('base64')],
    ]);
  }
  return assets;
}

const hosting=await readFile(path.join(root,'.openai','hosting.json'),'utf8');
const manifest=JSON.parse(hosting);
if(!manifest.project_id||manifest.d1!=='DB'||manifest.static)throw Error('Expected a Sites Worker manifest with a DB binding');
await mkdir(path.join(output,'server'),{recursive:true});
await mkdir(path.join(output,'.openai'),{recursive:true});
const assets=Object.fromEntries(await readAssets(client));
if(!assets['index.html']||!Object.keys(assets).some(key=>key.startsWith('assets/index-')))throw Error('Build the recorded game first');
await build({
  stdin:{
    resolveDir:root,sourcefile:'recorded-game.js',
    contents:`import {serveGame} from './web/src/server/worker.ts';
      const assets = ${JSON.stringify(assets)};
      export default {fetch(request,env){return serveGame(request,env,assets);}};`,
  },
  outfile:path.join(output,'server','index.js'),
  bundle:true,minify:true,format:'esm',target:'es2022',
});
await writeFile(path.join(output,'.openai','hosting.json'),hosting);
