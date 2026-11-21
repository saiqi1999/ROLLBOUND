export const races = {human:'人类', orc:'兽人', undead:'亡灵', monster:'怪物'} as const;
type Race = keyof typeof races;
type UnitDefinition = {name:string; race:Race; hp:number; atk:number; text:string; guardian?:true};

export const MEDIC_HEAL=12;
export const ORC_ARMOR_THRESHOLD=5;
export const ORC_RIDER_NEIGHBORS=3;
export const ARMORED_SKELETON_SPAWNS=3;
export const SLIME_REMOVAL_GAIN=2;

export const units = {
  guard: { name:'木盾卫士', race:'human', hp:12, atk:2, text:'攻击时，自身获得2点护盾。' },
  archer: { name:'见习弓手', race:'human', hp:7, atk:3, text:'每次摇到时，若与木盾卫士相邻，永久获得+1攻击力。' },
  medic: { name:'战地医师', race:'human', hp:8, atk:1, text:'为一个随机受伤的相邻友方单位恢复'+MEDIC_HEAL+'点生命值。' },
  king: { name:'亡灵法师', race:'undead', hp:12, atk:3, text:'招募时，额外获得2个骷髅兵。消耗所有相邻尸体，每具使其永久获得+2/+2。' },
  page: { name:'骷髅兵', race:'undead', hp:3, atk:1, text:'阵亡时，额外加入1具骷髅兵的尸体。' },
  orc: { name:'兽人', race:'orc', hp:10, atk:3, text:'攻击力超过'+ORC_ARMOR_THRESHOLD+'时，永久进化为重甲兽人。' },
  bone: { name:'骷髅弓箭手', race:'undead', hp:7, atk:2, text:'每当一个友方亡灵阵亡，获得本场+3攻击力。' },
  soldier: { name:'士兵', race:'human', hp:6, atk:2, text:'入场时，使所有友方在场人类获得+1生命值。' },
  swordsman: { name:'剑士', race:'human', hp:6, atk:2, text:'入场时，使相邻的友方在场人类获得+2/+2。' },
  axeman: { name:'重甲斧', race:'human', hp:10, atk:2, guardian:true, text:'入场和阵亡时，使所有友方在场人类获得3点护甲。' },
  lancer: { name:'长枪兵', race:'human', hp:6, atk:2, text:'每次摇到时，若相邻格有空位，获得+2/+1。' },
  templar: { name:'圣殿骑士', race:'human', hp:9, atk:2, guardian:true, text:'每场战斗首次阵亡时，满血复活并使所有友方在场人类获得+1/+1。' },
  wizard: { name:'法师', race:'human', hp:7, atk:2, text:'入场时，使相邻的在场友方单位获得+1/+1。本局每施放一个法术，此加成提高+1/+1。' },
  armoredOrc: { name:'重甲兽人', race:'orc', hp:24, atk:3, guardian:true, text:'与至少'+ORC_RIDER_NEIGHBORS+'个其他在场友方兽人相邻时，永久进化为兽人骑兵。' },
  slime: { name:'史莱姆', race:'monster', hp:6, atk:1, text:'在商店被移除时，使队伍中其余所有单位永久获得+'+SLIME_REMOVAL_GAIN+'/+'+SLIME_REMOVAL_GAIN+'。' },
  orcRider: { name:'兽人骑兵', race:'orc', hp:24, atk:3, text:'攻击时额外连击一次。每击杀一个敌人，永久获得+1/+1。' },
  armoredSkeleton: { name:'重甲骷髅', race:'undead', hp:12, atk:2, guardian:true, text:'阵亡时，招来'+ARMORED_SKELETON_SPAWNS+'个仅本场战斗使用的骷髅兵。' },
  bat: { name:'蝙蝠', race:'monster', hp:5, atk:2, text:'招募时，随机获得1个法术。' }
} as const satisfies Record<string,UnitDefinition>;
export type Kind = keyof typeof units;
export const unitKinds=Object.keys(units) as Kind[];
export const humanKinds=unitKinds.filter(kind=>units[kind].race==='human');
export const wizardEntryGain=(spellCasts=0)=>1+spellCasts;
const unitPrices:Record<Kind,number>={
  guard:2,archer:3,medic:3,king:5,page:1,orc:3,bone:2,
  soldier:2,swordsman:3,axeman:3,lancer:3,templar:4,wizard:3,armoredOrc:5,slime:1,
  orcRider:6,armoredSkeleton:4,bat:3
};
export const hasGuardian = (kind:Kind) => 'guardian' in units[kind];
export const canEvolveOrc = (kind:Kind,attack:number) => kind==='orc'&&attack>ORC_ARMOR_THRESHOLD;
export const RECRUIT_GAIN=3;
export const spells = {
  'surge': {name:'魔力强化', price:3, text:'使相邻的在场友方单位永久获得+2攻击力和+2生命值。'},
  'fireball': {name:'火球术', price:4, text:'消灭一个随机在场敌方单位。'},
  'recruit': {name:'召唤法阵', price:2, text:'随机招募一名人类，永久获得+'+RECRUIT_GAIN+'攻击力和+'+RECRUIT_GAIN+'生命值。'}
} as const;
export type SpellKind = keyof typeof spells;
export const spellKinds=Object.keys(spells) as SpellKind[];
export type Offer = { title:string; kinds:Kind[]; price:number; sold:boolean; spell?:SpellKind };
export function spellOffer(spell:SpellKind):Offer{
  return {title:spells[spell].name,kinds:[],price:spells[spell].price,sold:false,spell};
}
export const encounters: {name:string; camp:string; units:Kind[]; health:number; attack:number; gold:number}[] = [
  {name:'边境巡队',camp:'边境',units:['orc','orc','bone'],health:-3,attack:-1,gold:10},
  {name:'灰骨哨所',camp:'哨所',units:['orc','orc','bone','bone'],health:-2,attack:-1,gold:4},
  {name:'裂牙先锋',camp:'裂牙',units:['orc','orc','orc','bone','bone'],health:2,attack:0,gold:5},
  {name:'黑铁前线',camp:'黑铁',units:['axeman','swordsman','soldier','guard','lancer','medic'],health:0,attack:0,gold:6},
  {name:'荒原围军',camp:'荒原',units:['armoredOrc','orc','orc','orc','bone','bone','bone'],health:9,attack:2,gold:7},
  {name:'铁誓军团',camp:'铁誓',units:['templar','axeman','swordsman','soldier','guard','medic','archer','archer'],health:2,attack:3,gold:8},
  {name:'暮色王庭',camp:'王庭',units:['king','king','page','page','page','orc','orc','bone','bone'],health:13,attack:5,gold:9}
];
export const REFRESH_COST = 1;
export const REQUIRED_WINS = encounters.length;
export function unitOffer(kind:Kind):Offer {
  const kinds:Kind[]=[kind];
  if(kind==='king')kinds.push('page','page');
  return {kinds,price:unitPrices[kind],title:units[kind].name,sold:false};
}
