import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {encounters,REQUIRED_WINS} from '../src/data.ts';
import {advance,buy,commitRoll,newRun,startBattle,step} from '../src/engine.ts';

function mixSeed(seed) {
  let value = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

export function startingRuns(count, offset = 0) {
  return Array.from({length:count}, (_, index) => newRun(mixSeed(index + offset)));
}

function recruit(run) {
  const roll = mixSeed(run.seed ^ Math.imul(run.stage + 1, 0x7f4a7c15)) / 4294967296;
  const affordable = run.offers.flatMap((offer, index) =>
    !offer.spell && !offer.sold && offer.price <= run.gold ? [index] : []);
  if (!buy(run, affordable[Math.floor(roll * affordable.length)])) {
    throw Error('No affordable single recruit on stage ' + (run.stage + 1));
  }
}

function playFight(run) {
  startBattle(run);
  while (run.phase === 'battle') commitRoll(run, step(run.battle, 'board', {captureEvents:false}));
  return run.results.at(-1) === '胜利';
}

function advanceTrial(run) {
  // Continue even failed trials to measure each encounter without survivor selection.
  run.phase = 'result';
  advance(run);
}

export function compare(runs, limit = runs.length, keepResults = false) {
  let recruited = 0, skipped = 0, savedByRecruiting = 0;
  for (let index = 0; index < limit; index++) {
    const run = structuredClone(runs[index]);
    const skip = structuredClone(run);
    recruit(run);
    const withRecruit = playFight(run);
    const withoutRecruit = playFight(skip);
    recruited += Number(withRecruit);
    skipped += Number(withoutRecruit);
    savedByRecruiting += Number(withRecruit && !withoutRecruit);
    if (keepResults) {
      advanceTrial(run);
      runs[index] = run;
    }
  }
  return {recruited:recruited / limit, skipped:skipped / limit, savedByRecruiting:savedByRecruiting / limit};
}

function report(count, offset) {
  const runs = startingRuns(count, offset);
  const noRecruits = startingRuns(count, offset);
  const percent = value => (100 * value).toFixed(1) + '%';
  const stages = encounters.map(({name,units,attack,health}, index) => {
    const current = compare(runs, count, true);
    let noRecruitWins = 0;
    for (const run of noRecruits) {
      noRecruitWins += Number(playFight(run));
      advanceTrial(run);
    }
    return {
      '关卡':index+1, '对手':name, '人数':units.length, '每敌增益':attack+'/'+health,
      '每店招募一枚':percent(current.recruited), '仅跳过本店':percent(current.skipped),
      '因招募转胜':percent(current.savedByRecruiting), '一路不招募':percent(noRecruitWins/count)
    };
  });
  const clear = trials => percent(trials.filter(run => run.results.filter(result => result === '胜利').length >= REQUIRED_WINS).length / count);
  return {stages, clearWithRecruits:clear(runs), clearWithoutRecruits:clear(noRecruits)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = Number(process.argv[2] ?? 2000);
  const offset = Number(process.argv[3] ?? 100000);
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(offset) || offset < 0) {
    throw Error('Usage: node scripts/simulate-difficulty.mjs [positive sample count] [nonnegative seed offset]');
  }
  console.log('Samples per stage: ' + count + ' | Seed offset: ' + offset);
  const result = report(count, offset);
  console.table(result.stages);
  console.log('Clear rates with and without recruits: ' + result.clearWithRecruits + ' / ' + result.clearWithoutRecruits);
}
