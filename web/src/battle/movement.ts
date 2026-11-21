import {COMBAT,type Point} from './model.ts';

const MIN_DISTANCE=COMBAT.separation;
const EPSILON=1e-7;
const directions=[0,.64,-.64,1.26,-1.26];
const stopped={x:0,y:0};
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const add=(position:Point,velocity:Point,time:number)=>({
  x:position.x+velocity.x*time,
  y:position.y+velocity.y*time,
});

// Earliest contact in a normalized tick, accounting for both units' displacement.
function contact(a:Point,b:Point,da:Point,db:Point,remaining:number){
  const x=a.x-b.x,y=a.y-b.y,dx=da.x-db.x,dy=da.y-db.y;
  const approach=x*dx+y*dy;
  if(approach>=0)return remaining;
  const speed=dx*dx+dy*dy;
  const gap=Math.max(0,x*x+y*y-MIN_DISTANCE**2);
  const discriminant=approach**2-speed*gap;
  if(discriminant<=EPSILON)return remaining;
  return Math.min(remaining,gap/(-approach+Math.sqrt(discriminant)));
}

export function approachMotion(position:Point,target:Point,obstacles:Point[],speed:number,range:number,prefer:1|-1):Point{
  const gap=distance(position,target);
  if(gap<=range)return stopped;
  const direction=Math.atan2(target.y-position.y,target.x-position.x);
  let best=stopped,bestGap=gap;
  for(const turn of directions){
    const angle=direction+turn*prefer;
    const length=turn===0?Math.min(speed,gap-range+1):speed;
    const next=bounded(add(position,{x:Math.cos(angle),y:Math.sin(angle)},length));
    const velocity={x:next.x-position.x,y:next.y-position.y};
    let time=1;
    for(const obstacle of obstacles)time=contact(position,obstacle,velocity,stopped,time);
    const progress=distance(target,add(position,velocity,time));
    if(progress<bestGap-EPSILON){
      bestGap=progress;
      best={x:velocity.x*time,y:velocity.y*time};
    }
    if(time>=1&&turn===0)return best;
  }
  return best;
}

function bounded(point:Point):Point{
  const margin=MIN_DISTANCE/2;
  return {
    x:Math.max(margin,Math.min(COMBAT.width-margin,point.x)),
    y:Math.max(margin,Math.min(COMBAT.height-margin,point.y)),
  };
}

export function resolveMovement(snapshot:Point[],intents:Point[]):Point[]{
  let remaining=1;
  let positions=snapshot.slice();
  const velocities=intents.slice();
  while(remaining>EPSILON){
    let earliest=remaining, first=-1, second=-1;
    for(let a=0;a<positions.length;a++){
      for(let b=a+1;b<positions.length;b++){
        const time=contact(positions[a],positions[b],velocities[a],velocities[b],earliest);
        if(time<earliest){
          earliest=time;
          first=a;
          second=b;
        }
      }
    }
    positions=positions.map((position,index)=>add(position,velocities[index],earliest));
    remaining-=earliest;
    if(first<0)break;
    // A contact consumes at least one moving intent. Other units finish the same tick.
    velocities[first]=stopped;
    velocities[second]=stopped;
  }
  return positions;
}
