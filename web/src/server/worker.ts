import {handleLineups,type LineupEnv} from './lineups.ts';

export type GameAssets=Record<string,[type:string,body:string]>;

export function serveGame(request:Request,env:LineupEnv,assets:GameAssets){
  const {pathname}=new URL(request.url);
  if(pathname==='/api/battle-lineups')return handleLineups(request,env);
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
  const filename=pathname==='/'?'index.html':pathname.slice(1);
  if(!Object.hasOwn(assets,filename))return new Response('Not found',{status:404});
  const [type,body]=assets[filename];
  const headers={
    'content-type':type,
    'cache-control':filename.startsWith('assets/')?'private, max-age=86400, immutable':'private, no-cache',
  };
  const bytes=request.method==='HEAD'?null:Uint8Array.from(atob(body),character=>character.charCodeAt(0));
  return new Response(bytes,{headers});
}
