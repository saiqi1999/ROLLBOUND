import {arenaSprites} from '../.generated/arena-sprites.ts';

function copyToCanvas(source:ImageBitmap|HTMLImageElement){
  const canvas=document.createElement('canvas');
  canvas.width=source.width;
  canvas.height=source.height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('No canvas context for battle art');
  context.drawImage(source,0,0);
  return canvas;
}

async function readImage(url:string){
  const image=new Image();
  image.src=url;
  await image.decode();
  return image;
}

export async function decodeArenaSprite(key:string){
  const packed=arenaSprites[key];
  if(!packed)throw new Error('Unknown battle sprite '+key);
  if(typeof createImageBitmap==='function'){
    try{
      const bytes=Uint8Array.from(atob(packed),char=>char.charCodeAt(0));
      const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
      try{return copyToCanvas(bitmap);}finally{bitmap.close();}
    }catch{/* Fall back to the image element on browsers with a limited bitmap decoder. */}
  }
  const image=await readImage('data:image/png;base64,'+packed).catch(()=>
    readImage(import.meta.env.BASE_URL+'art/'+key+'.png'));
  return copyToCanvas(image);
}
