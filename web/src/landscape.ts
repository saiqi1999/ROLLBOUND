// Low-resolution scenery behind the original character sprites.
export function scenery(canvas:HTMLCanvasElement, theme:string) {
  const ctx=canvas.getContext('2d')!;
  const w=192,h=91;canvas.width=w;canvas.height=h;
  const palette=theme==='king'?['#242638','#393445','#4c4052','#242b34','#343c39','#b7a16b']:
    theme==='guard'||theme==='archer'?['#263842','#394c52','#526165','#273531','#36423a','#bfad76']:
    ['#253f3d','#36534a','#567063','#253b33','#34483a','#c6b380'];
  const rect=(x:number,y:number,ww:number,hh:number,col:string)=>{ctx.fillStyle=col;ctx.fillRect(Math.floor(x),Math.floor(y),ww,hh);};
  let seed=theme==='king'?134:theme==='guard'?48:993;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  rect(0,0,w,h,palette[0]);
  for(let i=0;i<50;i++)rect(random()*w,random()*35,1,1,'#9e9e85');
  for(let x=0;x<w;x+=2){
    const q=33+Math.sin(x*.05)*8+Math.sin(x*.12)*4;
    rect(x,q,2,h,palette[1]);rect(x,42+Math.cos(x*.073)*6,2,h,palette[2]);
  }
  const tower=(x:number,y:number,s:number)=>{
    rect(x,y,9*s,55,s===1?palette[1]:palette[3]);for(let i=0;i<3;i++)rect(x+i*3*s,y-2*s,s*2,3*s,palette[3]);
    rect(x+3*s,y+7*s,2*s,4*s,palette[5]);
  };
  if(theme==='king'){tower(53,26,1);tower(120,22,1);rect(62,35,59,16,palette[1]);for(let i=0;i<9;i++)rect(62+i*7,32,4,6,palette[1]);}
  else tower(136,33,1);
  const tree=(x:number,y:number,s:number)=>{rect(x-1,y,2,22*s,palette[3]);for(let i=0;i<9;i++)rect(x-Math.floor(i*.72*s),y+i*2*s,Math.max(2,Math.floor(i*1.5*s)),3*s,palette[3]);};
  for(let i=0;i<25;i++){const x=random()*w;tree(x,36+random()*11,.6+random()*.8);}
  for(let x=0;x<w;x+=2)rect(x,64+Math.sin(x*.05)*2,2,h,palette[4]);
  for(let i=0;i<210;i++){const x=random()*w,y=67+random()*24;rect(x,y,1+random()*3,1,random()>.6?palette[3]:palette[2]);}
  tree(2,16,2.5);tree(190,9,2.8);
  for(const x of [27,162]){
    rect(x,57,2,16,'#302b26');rect(x-1,55,4,3,'#c49154');rect(x,52,2,4,'#f3d789');
  }
}
