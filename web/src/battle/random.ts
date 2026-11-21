export type RandomState = {rng:number};

export function rng(state:RandomState){
  state.rng=(Math.imul(1664525,state.rng)+1013904223)>>>0;
  return state.rng/4294967296;
}

export function pick<T>(items:T[],state:RandomState):T{
  return items[Math.floor(rng(state)*items.length)];
}

export function shuffle<T>(items:T[],state:RandomState):T[]{
  for(let i=items.length-1;i>0;i--){
    const j=Math.floor(rng(state)*(i+1));
    [items[i],items[j]]=[items[j],items[i]];
  }
  return items;
}
