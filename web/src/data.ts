export const units = {
  guard: { name:'木盾卫士', hp:12, atk:2, text:'攻击时，自身获得2点护盾。' },
  archer: { name:'见习弓手', hp:7, atk:3, text:'与木盾卫士相邻时，攻击力+1。成长保留至本局结束。' },
  medic: { name:'战地医师', hp:8, atk:1, text:'为一个随机受伤的相邻友方单位恢复3点生命值。' },
  king: { name:'暮王', hp:12, atk:3, text:'消耗所有相邻尸体。每消耗一具，永久获得+2攻击力和+2生命值。' },
  page: { name:'纸甲侍从', hp:3, atk:1, text:'普通攻击。' },
  orc: { name:'兽人', hp:10, atk:3, text:'普通攻击。' },
  bone: { name:'骨弓手', hp:7, atk:2, text:'与兽人相邻时，本轮攻击力+2。' }
} as const;
export type Kind = keyof typeof units;
export type Offer = { title:string; kinds:Kind[]; price:number; sold:boolean };
export const encounters: {name:string; units:Kind[]}[] = [
  {name:'边境巡队',units:['orc','orc','bone']},
  {name:'灰骨哨所',units:['orc','orc','bone','bone']},
  {name:'暮色王庭',units:['king','page','page','orc','bone','bone']}
];
export function offer(kinds:Kind[],price:number,title=units[kinds[0]].name as string):Offer {
  return {kinds,price,title,sold:false};
}
export const royal = () => offer(['king','page','page'],5,'暮王与侍从');
