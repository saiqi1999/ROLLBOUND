export const races = {human:'人类', orc:'兽人', undead:'亡灵', monster:'怪物'} as const;
type Race = keyof typeof races;
type UnitDefinition = {name:string; race:Race; hp:number; atk:number; text:string; guardian?:true};

export const MEDIC_HEAL=12;
export const ORC_ARMOR_THRESHOLD=5;
export const ORC_RIDER_NEIGHBORS=2;
export const ARMORED_SKELETON_SPAWNS=3;
export const SLIME_REMOVAL_GAIN=2;
export const GUARD_SHIELD=2;
export const HUMAN_ARMOR=3;
export const NECROMANCER_GAIN=2;
export const NECROMANCER_LIMIT=2;
export const SKELETON_GOLD=2;
export const BONE_ATTACK_GAIN=3;

export const units = {
  guard: { name:'木盾卫士', race:'human', hp:12, atk:2, text:'攻击时，获得'+GUARD_SHIELD+'护盾。' },
  archer: { name:'见习弓手', race:'human', hp:7, atk:3, text:'与木盾卫士相邻时，永久获得+1攻击。每店一次。' },
  medic: { name:'战地医师', race:'human', hp:8, atk:1, text:'为一个随机相邻友方备战。下场战斗中，两者在场且该友方降至半血时，为其恢复至多'+MEDIC_HEAL+'生命。每战一次。' },
  king: { name:'亡灵法师', race:'undead', hp:12, atk:3, text:'招募时，额外获得2名骷髅兵。每摇消灭至多'+NECROMANCER_LIMIT+'名相邻的骷髅兵、重甲骷髅或骷髅弓箭手。每消灭一名，永久获得+'+NECROMANCER_GAIN+'/+'+NECROMANCER_GAIN+'。' },
  page: { name:'骷髅兵', race:'undead', hp:3, atk:1, text:'在商店被消灭时，获得'+SKELETON_GOLD+'金币。' },
  orc: { name:'兽人', race:'orc', hp:10, atk:3, text:'备战攻击力超过'+ORC_ARMOR_THRESHOLD+'时，永久进化为重甲兽人。' },
  bone: { name:'骷髅弓箭手', race:'undead', hp:7, atk:2, text:'同盘其他友方亡灵被消灭时，下场+'+BONE_ATTACK_GAIN+'攻击。被消灭时，使亡灵法师下场+'+BONE_ATTACK_GAIN+'攻击。友方亡灵在战斗中阵亡时，本场+'+BONE_ATTACK_GAIN+'攻击。' },
  soldier: { name:'士兵', race:'human', hp:6, atk:2, text:'使同盘其他友方人类下场+1生命。' },
  swordsman: { name:'剑士', race:'human', hp:6, atk:2, text:'使相邻友方人类下场+2/+2。' },
  axeman: { name:'重甲斧', race:'human', hp:10, atk:2, guardian:true, text:'使相邻友方人类下场获得'+HUMAN_ARMOR+'初始护甲。阵亡时，使所有在场友方人类获得'+HUMAN_ARMOR+'护甲。' },
  lancer: { name:'长枪兵', race:'human', hp:6, atk:2, text:'有相邻空格时，下场+2/+1。' },
  templar: { name:'圣殿骑士', race:'human', hp:9, atk:2, guardian:true, text:'每场战斗首次阵亡时，满血复活并使所有友方在场人类获得+1/+1。' },
  wizard: { name:'法师', race:'human', hp:7, atk:2, text:'使相邻友方下场+1/+1。本局每施放一个法术，此增益提高+1/+1，最高+4/+4。' },
  armoredOrc: { name:'重甲兽人', race:'orc', hp:24, atk:3, guardian:true, text:'与至少'+ORC_RIDER_NEIGHBORS+'名其他友方兽人相邻时，永久进化为兽人骑兵。' },
  slime: { name:'史莱姆', race:'monster', hp:6, atk:1, text:'在商店被移除时，使队伍中其余所有单位永久获得+'+SLIME_REMOVAL_GAIN+'/+'+SLIME_REMOVAL_GAIN+'。' },
  orcRider: { name:'兽人骑兵', race:'orc', hp:24, atk:3, text:'攻击时额外连击一次。每击杀一个敌人，永久获得+1/+1。' },
  armoredSkeleton: { name:'重甲骷髅', race:'undead', hp:12, atk:2, guardian:true, text:'在商店被消灭时，永久招募'+ARMORED_SKELETON_SPAWNS+'名骷髅兵，并放入随机空格。战斗中阵亡时，立即召唤'+ARMORED_SKELETON_SPAWNS+'名临时骷髅兵。' },
  bat: { name:'蝙蝠', race:'monster', hp:5, atk:2, text:'招募时，随机获得1个法术。' }
} as const satisfies Record<string,UnitDefinition>;
export type Kind = keyof typeof units;
export const unitKinds=Object.keys(units) as Kind[];
export const humanKinds=unitKinds.filter(kind=>units[kind].race==='human');
export const wizardEntryGain=(spellCasts=0)=>Math.min(4,1+spellCasts);
const unitPrices:Record<Kind,number>={
  guard:2,archer:3,medic:3,king:5,page:1,orc:3,bone:2,
  soldier:2,swordsman:3,axeman:3,lancer:3,templar:4,wizard:3,armoredOrc:5,slime:1,
  orcRider:6,armoredSkeleton:4,bat:3
};
export const hasGuardian = (kind:Kind) => 'guardian' in units[kind];
export const canEvolveOrc = (kind:Kind,attack:number) => kind==='orc'&&attack>ORC_ARMOR_THRESHOLD;
export const RECRUIT_GAIN=3;
export const spells = {
  'surge': {name:'魔力强化', price:3, text:'使相邻友方单位永久获得+2/+2。'},
  'fireball': {name:'火球术', price:4, text:'装填到下一战。开场消灭一个随机在场敌人。'},
  'recruit': {name:'召唤法阵', price:2, text:'随机招募一名人类，永久获得+'+RECRUIT_GAIN+'/+'+RECRUIT_GAIN+'，并放入一个随机空格。'}
} as const;
export type SpellKind = keyof typeof spells;
export const spellKinds=Object.keys(spells) as SpellKind[];
export type Offer = { title:string; kinds:Kind[]; price:number; sold:boolean; spell?:SpellKind };
export function spellOffer(spell:SpellKind):Offer{
  return {title:spells[spell].name,kinds:[],price:spells[spell].price,sold:false,spell};
}
export const encounters: {name:string; camp:string; units:Kind[]; health:number; attack:number; gold:number}[] = [
  {name:'边境巡队',camp:'边境',units:['orc','orc','bone'],health:-3,attack:-1,gold:20},
  {name:'灰骨哨所',camp:'哨所',units:['orc','orc','bone','bone'],health:-2,attack:-1,gold:8},
  {name:'裂牙先锋',camp:'裂牙',units:['orc','orc','orc','bone','bone'],health:2,attack:0,gold:10},
  {name:'黑铁前线',camp:'黑铁',units:['axeman','swordsman','soldier','guard','lancer','medic'],health:0,attack:0,gold:12},
  {name:'荒原围军',camp:'荒原',units:['armoredOrc','orc','orc','orc','bone','bone','bone'],health:9,attack:2,gold:14},
  {name:'铁誓军团',camp:'铁誓',units:['templar','axeman','swordsman','soldier','guard','medic','archer','archer'],health:2,attack:3,gold:16},
  {name:'暮色王庭',camp:'王庭',units:['king','king','page','page','page','orc','orc','bone','bone'],health:13,attack:5,gold:18}
];
export const REFRESH_COST = 1;
export const REQUIRED_WINS = encounters.length;
export function unitOffer(kind:Kind):Offer {
  const kinds:Kind[]=[kind];
  if(kind==='king')kinds.push('page','page');
  return {kinds,price:unitPrices[kind],title:units[kind].name,sold:false};
}
