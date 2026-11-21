export const races = {human:'人类', orc:'兽人', undead:'亡灵', monster:'怪物'} as const;
type Race = keyof typeof races;
type UnitDefinition = {name:string; race:Race; hp:number; atk:number; text:string; guardian?:true};

export const units = {
  guard: { name:'木盾卫士', race:'human', hp:12, atk:2, text:'攻击时，自身获得2点护盾。' },
  archer: { name:'见习弓手', race:'human', hp:7, atk:3, text:'每次摇到时，若与木盾卫士相邻，永久获得+1攻击力。' },
  medic: { name:'战地医师', race:'human', hp:8, atk:1, text:'为一个随机受伤的相邻友方单位恢复3点生命值。' },
  king: { name:'暮王', race:'undead', hp:12, atk:3, text:'消耗所有相邻尸体。每消耗一具，永久获得+2攻击力和+2生命值。' },
  page: { name:'纸甲侍从', race:'undead', hp:3, atk:1, text:'普通攻击。' },
  orc: { name:'兽人', race:'orc', hp:10, atk:3, text:'普通攻击。' },
  bone: { name:'骨弓手', race:'undead', hp:7, atk:2, text:'与兽人相邻时，本轮攻击力+2。' },
  soldier: { name:'士兵', race:'human', hp:6, atk:2, text:'入场时，使所有友方在场人类获得+1生命值。' },
  swordsman: { name:'剑士', race:'human', hp:6, atk:2, text:'入场时，使相邻的友方在场人类获得+2/+2。' },
  axeman: { name:'重甲斧', race:'human', hp:10, atk:2, guardian:true, text:'入场和阵亡时，使所有友方在场人类获得3点护甲。' },
  lancer: { name:'长枪兵', race:'human', hp:6, atk:2, text:'每次摇到时，若相邻格有空位，获得+2/+1。' },
  templar: { name:'圣殿骑士', race:'human', hp:9, atk:2, guardian:true, text:'每场战斗首次阵亡时，满血复活并使所有友方在场人类获得+1/+1。' }
} as const satisfies Record<string,UnitDefinition>;
export type Kind = keyof typeof units;
export const hasGuardian = (kind:Kind) => 'guardian' in units[kind];
export const spells = {
  'surge': {name:'魔力强化', price:3, text:'使相邻的在场友方单位永久获得+2攻击力和+2生命值。'},
  'fireball': {name:'火球术', price:4, text:'消灭一个随机在场敌方单位。'}
} as const;
export type SpellKind = keyof typeof spells;
export type Offer = { title:string; kinds:Kind[]; price:number; sold:boolean; spell?:SpellKind };
export function spellOffers():Offer[]{
  return (Object.keys(spells) as SpellKind[]).map(spell=>({
    title:spells[spell].name, kinds:[], price:spells[spell].price, sold:false, spell
  }));
}
export const encounters: {name:string; camp:string; units:Kind[]; health:number; attack:number}[] = [
  {name:'边境巡队',camp:'边境',units:['orc','orc','bone'],health:0,attack:0},
  {name:'灰骨哨所',camp:'哨所',units:['orc','orc','bone','bone'],health:0,attack:1},
  {name:'裂牙先锋',camp:'裂牙',units:['orc','orc','orc','bone','bone'],health:1,attack:2},
  {name:'黑铁前线',camp:'黑铁',units:['axeman','swordsman','soldier','guard','lancer','medic'],health:0,attack:0},
  {name:'荒原围军',camp:'荒原',units:['orc','orc','orc','orc','bone','bone','bone'],health:6,attack:2},
  {name:'铁誓军团',camp:'铁誓',units:['templar','axeman','swordsman','soldier','lancer','medic','archer','archer'],health:1,attack:0},
  {name:'暮色王庭',camp:'王庭',units:['king','king','page','page','page','orc','orc','bone','bone'],health:10,attack:2}
];
export const GOLD_REWARD = 3;
export const REFRESH_COST = 1;
export const REQUIRED_WINS = encounters.length;
export function offer(kinds:Kind[],price:number,title=units[kinds[0]].name as string):Offer {
  return {kinds,price,title,sold:false};
}
export const royal = () => offer(['king','page','page'],5,'暮王与侍从');
