import {magicTags,type TagId} from './magic-tags.ts';

export const races = {human:'人类', orc:'兽人', undead:'亡灵', monster:'怪物', demon:'恶魔'} as const;
type Race = keyof typeof races;
type UnitEffectContext = {spellCasts?:number;evolutionTriggers?:number};
type UnitDefinition = {
  name:string;race:Race|readonly Race[];hp:number;atk:number;text:string|((context:UnitEffectContext)=>string);guardian?:true;
};

export const TEMPLAR_DEATH_GAIN=4;
export const SWORDSMAN_GAIN=1;
export const ORC_ARMOR_THRESHOLD=5;
export const ORC_RIDER_NEIGHBORS=2;
export const ARMORED_SKELETON_SPAWNS=3;
export const SLIME_REMOVAL_GAIN=2;
export const GUARD_SHIELD=2;
export const HUMAN_ARMOR=3;
export const NECROMANCER_GAIN=3;
export const NECROMANCER_GOLD=2;
export const BONE_ATTACK_GAIN=4;
export const FEL_SQUIRE_GAIN=3;
export const GREATSWORD_COPY_GAIN=8;
export const WEREWOLF_RECRUIT_GAIN=1;
export const DEMON_STAT_PERCENT=50;
export const wizardEntryGain=(spellCasts=0)=>1+spellCasts;
export const eliteOrcEvolutionGain=(evolutionTriggers=0)=>1+evolutionTriggers;

export const units = {
  guard: { name:'木盾卫士', race:'human', hp:12, atk:2, text:'攻击时，获得'+GUARD_SHIELD+'护盾。' },
  archer: { name:'见习弓手', race:'human', hp:7, atk:3, text:'与守护单位相邻时，永久获得+1攻击。' },
  medic: { name:'牧师', race:'human', hp:8, atk:1, text:'触发相邻友方单位的死亡时效果。' },
  king: { name:'亡灵法师', race:'undead', hp:12, atk:3, text:'招募时，额外获得2名骷髅兵。消灭相邻的友方亡灵（亡灵法师除外）。每消灭一名，永久获得+'+NECROMANCER_GAIN+'/+'+NECROMANCER_GAIN+'和'+NECROMANCER_GOLD+'金币。' },
  page: { name:'骷髅兵', race:'undead', hp:3, atk:1, text:'' },
  orc: { name:'兽人', race:'orc', hp:10, atk:3, text:'攻击力达到'+ORC_ARMOR_THRESHOLD+'时，永久进化为重甲兽人。' },
  bone: { name:'骷髅弓箭手', race:'undead', hp:7, atk:2, text:'友方亡灵死亡时，本单位获得+'+BONE_ATTACK_GAIN+'攻击力。' },
  soldier: { name:'士兵', race:'human', hp:6, atk:2, text:'使同盘其他友方人类永久+1生命。' },
  swordsman: { name:'剑士', race:'human', hp:6, atk:2, text:'使相邻友方人类永久+'+SWORDSMAN_GAIN+'/+'+SWORDSMAN_GAIN+'。' },
  axeman: { name:'重甲斧', race:'human', hp:10, atk:2, guardian:true, text:'使相邻友方人类永久获得'+HUMAN_ARMOR+'初始护甲。死亡时，使其他友方人类获得'+HUMAN_ARMOR+'护甲。' },
  lancer: { name:'长枪兵', race:'human', hp:6, atk:2, text:'有相邻空格时，永久+2/+1。' },
  templar: { name:'圣殿骑士', race:'human', hp:9, atk:2, guardian:true, text:'死亡时，使其他友方人类获得+'+TEMPLAR_DEATH_GAIN+'/+'+TEMPLAR_DEATH_GAIN+'。' },
  wizard: { name:'法师', race:'human', hp:7, atk:2, text:({spellCasts})=>{
    const gain=wizardEntryGain(spellCasts);
    return '使相邻友方永久获得+'+gain+'/+'+gain+'。每施放一个法术，强化此效果。每次摇盘可连锁触发。';
  } },
  armoredOrc: { name:'重甲兽人', race:'orc', hp:24, atk:6, guardian:true, text:'与至少'+ORC_RIDER_NEIGHBORS+'名其他友方兽人相邻时，永久进化为兽人骑兵。' },
  slime: { name:'史莱姆', race:'monster', hp:6, atk:1, text:'在商店被移除时，使队伍中其余所有单位永久获得+'+SLIME_REMOVAL_GAIN+'/+'+SLIME_REMOVAL_GAIN+'。' },
  orcRider: { name:'兽人骑兵', race:'orc', hp:24, atk:9, text:'攻击时额外连击一次。每击杀一个敌人，永久获得+1/+1。' },
  armoredSkeleton: { name:'重甲骷髅', race:'undead', hp:12, atk:2, guardian:true, text:'死亡时，招来'+ARMORED_SKELETON_SPAWNS+'名骷髅兵。商店中永久入队并寻找空格上盘，战斗中立即召唤临时单位。' },
  bat: { name:'蝙蝠', race:'monster', hp:5, atk:2, text:'招募时，随机获得1个法术。' },
  greatswordSkeleton: { name:'大剑骷髅', race:'undead', hp:8, atk:3, text:'在商店被消灭时，复制自身并使复制永久获得+'+GREATSWORD_COPY_GAIN+'/+'+GREATSWORD_COPY_GAIN+'。下次摇盘或开战前入队。' },
  eliteOrc: { name:'精英兽人', race:'orc', hp:16, atk:4, text:({evolutionTriggers})=>{
    const gain=eliteOrcEvolutionGain(evolutionTriggers);
    return '友方兽人进化时，使所有友方兽人永久获得+'+gain+'/+'+gain+'，并强化此效果。';
  } },
  werebear: { name:'熊人', race:'monster', hp:18, atk:3, text:'攻击时，获得等同于自身攻击力的护甲。' },
  werewolf: { name:'狼人', race:'monster', hp:8, atk:3, text:'你购买其他单位时，永久获得+'+WEREWOLF_RECRUIT_GAIN+'/+'+WEREWOLF_RECRUIT_GAIN+'。' },
  warlock: { name:'术士', race:'orc', hp:10, atk:3, text:'使相邻的兽人进化为邪能侍从，重甲兽人进化为邪能守卫。' },
  felSquire: { name:'邪能侍从', race:['orc','undead'], hp:10, atk:3, text:'死亡时，使所有友方单位获得+'+FEL_SQUIRE_GAIN+'/+'+FEL_SQUIRE_GAIN+'。' },
  felGuard: { name:'邪能守卫', race:['orc','undead'], hp:24, atk:6, text:'死亡时，随机获得1枚标签。' },
  demon: { name:'小恶魔', race:'demon', hp:7, atk:3, text:'每次摇盘，永久获得身材最大的相邻友方单位'+DEMON_STAT_PERCENT+'%的攻击和生命（身材为攻击与生命之和，分别向上取整）。' },
} as const satisfies Record<string,UnitDefinition>;
export type Kind = keyof typeof units;
export const unitKinds=Object.keys(units) as Kind[];
export function unitRaces(kind:Kind):readonly Race[]{
  const {race}=units[kind];
  return typeof race==='string'?[race]:race;
}
export const hasRace=(kind:Kind,race:Race)=>unitRaces(kind).includes(race);
export const humanKinds=unitKinds.filter(kind=>hasRace(kind,'human'));
export function unitEffectText(kind:Kind,context:UnitEffectContext={}){
  const {text}=units[kind];
  return typeof text==='function'?text(context):text;
}
type ShopKind=Exclude<Kind,'felSquire'|'felGuard'>;
const unitPrices:Record<ShopKind,number>={
  guard:2,archer:3,medic:3,king:5,page:1,orc:3,bone:2,
  soldier:2,swordsman:3,axeman:3,lancer:3,templar:4,wizard:3,armoredOrc:5,slime:1,
  orcRider:9,armoredSkeleton:4,bat:3,greatswordSkeleton:4,eliteOrc:5,werebear:5,werewolf:4,warlock:5,demon:3,
};
export const shopKinds=unitKinds.filter((kind):kind is ShopKind=>Object.hasOwn(unitPrices,kind));
export const hasGuardian = (kind:Kind) => 'guardian' in units[kind];
export const canEvolveOrc = (kind:Kind,attack:number) => kind==='orc'&&attack>=ORC_ARMOR_THRESHOLD;
export const RECRUIT_GAIN=3;
export const spells = {
  'surge': {name:'魔力强化', price:3, text:'使相邻友方单位永久获得+2/+2。'},
  'fireball': {name:'火球术', price:4, text:'装填。开场消灭一个随机在场敌人。'},
  'recruit': {name:'召唤法阵', price:2, text:'随机招募一名人类，永久获得+'+RECRUIT_GAIN+'/+'+RECRUIT_GAIN+'，并放入一个随机空格。'}
} as const;
export type SpellKind = keyof typeof spells;
export const spellKinds=Object.keys(spells) as SpellKind[];
type OfferBase = {title:string;price:number;sold:boolean};
type UnitOffer = OfferBase&{type:'unit';kinds:[ShopKind,...Kind[]]};
export type Offer = UnitOffer
  | OfferBase&{type:'spell';spell:SpellKind}
  | OfferBase&{type:'tag';tag:TagId};
export function spellOffer(spell:SpellKind):Offer{
  return {type:'spell',title:spells[spell].name,price:spells[spell].price,sold:false,spell};
}
export function tagOffer(tag:TagId):Offer{
  return {type:'tag',title:magicTags[tag].name,price:magicTags[tag].price,sold:false,tag};
}
export const encounters: {name:string; camp:string; units:Kind[]; health:number; attack:number; gold:number}[] = [
  {
    name:'边境巡队',camp:'边境',health:-2,attack:-1,gold:20,
    units:['orc','orc','bone','page'],
  },
  {
    name:'灰骨哨所',camp:'哨所',health:-2,attack:-1,gold:8,
    units:['orc','orc','orc','bone','bone'],
  },
  {
    name:'裂牙先锋',camp:'裂牙',health:2,attack:0,gold:10,
    units:['orc','orc','orc','bone','bone','orcRider','armoredOrc'],
  },
  {
    name:'黑铁前线',camp:'黑铁',health:2,attack:1,gold:12,
    units:['axeman','templar','swordsman','soldier','guard','lancer','medic','archer','archer','wizard'],
  },
  {
    name:'荒原围军',camp:'荒原',health:10,attack:3,gold:14,
    units:['armoredOrc','orcRider','orcRider','orc','orc','bone','bone','bone','armoredSkeleton',
      'orc','orc','armoredOrc'],
  },
  {
    name:'铁誓军团',camp:'铁誓',health:11,attack:5,gold:16,
    units:['templar','axeman','swordsman','swordsman','soldier','guard','medic','archer','archer',
      'guard','wizard','lancer','archer','axeman','archer'],
  },
  {
    name:'暮色王庭',camp:'王庭',health:12,attack:5,gold:18,
    units:['king','king','armoredSkeleton','armoredSkeleton','orcRider','orcRider','armoredOrc','page','page',
      'orc','orc','bone','bone','bone','bone','bone','orc','orc'],
  },
];
export const REFRESH_COST = 1;
export const REQUIRED_WINS = encounters.length;
export function unitOffer(kind:ShopKind):UnitOffer {
  const kinds:[ShopKind,...Kind[]]=[kind];
  if(kind==='king')kinds.push('page','page');
  return {type:'unit',kinds,price:unitPrices[kind],title:units[kind].name,sold:false};
}
