import {COMBAT,type Point} from './model.ts';

const MIN_DISTANCE=COMBAT.separation;
const EPSILON=1e-7;
const FIELD_MARGIN=MIN_DISTANCE/2;
const DETOUR_STEP=24;
const neighbors=[
  [1,0],[1,1],[1,-1],[0,1],[0,-1],[-1,1],[-1,-1],[-1,0],
] as const;
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

function safeSegment(from:Point,to:Point,obstacles:Point[]){
  const step={x:to.x-from.x,y:to.y-from.y};
  return obstacles.every(obstacle=>contact(from,obstacle,step,stopped,1)>=1-EPSILON);
}

export function findDetour(start:Point,target:Point,obstacles:Point[],range:number){
  // Anchor the search grid at the fighter's exact position so the first step also checks collisions.
  const left=Math.ceil((FIELD_MARGIN-start.x)/DETOUR_STEP);
  const top=Math.ceil((FIELD_MARGIN-start.y)/DETOUR_STEP);
  const right=Math.floor((COMBAT.width-FIELD_MARGIN-start.x)/DETOUR_STEP);
  const bottom=Math.floor((COMBAT.height-FIELD_MARGIN-start.y)/DETOUR_STEP);
  const columns=right-left+1,rows=bottom-top+1;
  const origin=-top*columns-left;
  const previous=new Int32Array(columns*rows).fill(-1);
  const queue=[origin];
  previous[origin]=origin;
  const position=(cell:number)=>({
    x:start.x+(cell%columns+left)*DETOUR_STEP,
    y:start.y+(Math.floor(cell/columns)+top)*DETOUR_STEP,
  });
  for(let i=0;i<queue.length;i++){
    const cell=queue[i],from=position(cell);
    if(distance(from,target)<=range-1){
      const route:Point[]=[];
      for(let node=cell;node!==origin;node=previous[node])route.push(position(node));
      return route.reverse();
    }
    const column=cell%columns,row=Math.floor(cell/columns);
    const reach=MIN_DISTANCE+DETOUR_STEP;
    const nearby=obstacles.filter(other=>Math.abs(from.x-other.x)<=reach&&Math.abs(from.y-other.y)<=reach);
    for(const [dx,dy] of neighbors){
      const x=column+dx,y=row+dy;
      if(x<0||x>=columns||y<0||y>=rows)continue;
      const next=y*columns+x;
      if(previous[next]!==-1||!safeSegment(from,position(next),nearby))continue;
      previous[next]=cell;
      queue.push(next);
    }
  }
  return [];
}

export function followDetour(from:Point,waypoints:Point[],obstacles:Point[],speed:number){
  while(waypoints.length&&distance(from,waypoints[0])<=EPSILON)waypoints.shift();
  for(let i=waypoints.length-1;i>=0;i--){
    const point=waypoints[i];
    const gap=distance(from,point);
    if(gap<=EPSILON||!safeSegment(from,point,obstacles))continue;
    waypoints.splice(0,i);
    const fraction=Math.min(1,speed/gap);
    return {x:(point.x-from.x)*fraction,y:(point.y-from.y)*fraction};
  }
}

function bounded(point:Point):Point{
  return {
    x:Math.max(FIELD_MARGIN,Math.min(COMBAT.width-FIELD_MARGIN,point.x)),
    y:Math.max(FIELD_MARGIN,Math.min(COMBAT.height-FIELD_MARGIN,point.y)),
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
