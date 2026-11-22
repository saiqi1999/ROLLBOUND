export const tagRegions={
  topLeft:[0,1,4,5],
  topRight:[2,3,6,7],
  bottomLeft:[8,9,12,13],
  bottomRight:[10,11,14,15],
  center:[5,6,9,10],
} as const;

export const GROWTH_TAG_GAIN=5;
export const TEAM_TAG_HEALTH_DIVISOR=10;

export const magicTags={
  remove:{name:'移除',price:2,text:'将一个友方棋子移出队伍。'},
  topLeft:{name:'左上',price:2,text:'摇盘时，优先落在左上四格。'},
  topRight:{name:'右上',price:2,text:'摇盘时，优先落在右上四格。'},
  bottomLeft:{name:'左下',price:2,text:'摇盘时，优先落在左下四格。'},
  bottomRight:{name:'右下',price:2,text:'摇盘时，优先落在右下四格。'},
  center:{name:'中心',price:3,text:'摇盘时，优先落在中央四格。'},
  double:{name:'双重',price:5,text:'每次普攻最多命中射程内两个不同敌人。'},
  triple:{name:'三重',price:8,text:'每次普攻最多命中射程内三个不同敌人。'},
  clone:{name:'分身',price:7,text:'入场时，召唤一个继承自身属性和技能的临时分身。'},
  lifesteal:{name:'吸血',price:4,text:'攻击命中时，恢复等同于伤害的生命，包含超杀。'},
  shield:{name:'护盾',price:5,text:'攻击命中时，获得等同于伤害的护盾，包含超杀。'},
  growth:{name:'成长',price:5,text:'每次商店结束时，永久获得+'+GROWTH_TAG_GAIN+'/+'+GROWTH_TAG_GAIN+'。'},
  team:{name:'团队',price:5,text:'阵亡时，其他在场友方本场获得等同于自身最大生命十分之一的攻击与生命，向下取整。'},
} as const;

export type RegionTag=keyof typeof tagRegions;
export type TagId=keyof typeof magicTags;
export type AppliedTag=Exclude<TagId,'remove'>;
export type TagInventory=Partial<Record<TagId,number>>;

export const tagIds=Object.keys(magicTags) as TagId[];
export const isRegionTag=(tag:TagId|undefined):tag is RegionTag=>tag!==undefined&&Object.hasOwn(tagRegions,tag);
export const teamTagGain=(health:number)=>Math.floor(health/TEAM_TAG_HEALTH_DIVISOR);

export function tagCount(inventory:TagInventory,tag?:TagId){
  return tag?inventory[tag]??0:Object.values(inventory).reduce((total,count)=>total+count,0);
}

export function addTag(inventory:TagInventory,tag:TagId){
  inventory[tag]=tagCount(inventory,tag)+1;
}
