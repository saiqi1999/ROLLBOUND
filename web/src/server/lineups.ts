import {COMBAT,FIELD_LIMIT} from '../battle/model.ts';
import {encounters,units} from '../data.ts';
import type {LineupRecord,LineupUnit} from '../lineup-log.ts';
import {magicTags} from '../magic-tags.ts';

type Value=string|number|null;
type Statement={
  bind(...values:Value[]):Statement;
  run():Promise<unknown>;
  all<Row>():Promise<{results:Row[]}>;
};
type Database={prepare(sql:string):Statement};
export type LineupEnv={DB?:Database};
type StoredRow=Omit<LineupRecord,'lineup'>&{cursor:number;lineup:string};

const limit=128*1024;
const idPattern=/^[0-9a-f]{32}$/;
const unitIdPattern=/^0-\d+(?:-clone)?$/;
const outcomes=new Set(['win','loss','draw']);
const fields=new Set(['id','kind','atk','hp','armor','tag','cloneOf']);

const insert=`
  INSERT INTO battle_lineups (
    battle_id, run_id, round, seed, ruleset, started_at, fireballs, lineup, result, ticks
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(battle_id) DO UPDATE SET result=excluded.result, ticks=excluded.ticks
  WHERE battle_lineups.result IS NULL AND excluded.result IS NOT NULL
    AND battle_lineups.run_id=excluded.run_id AND battle_lineups.round=excluded.round
    AND battle_lineups.seed=excluded.seed AND battle_lineups.ruleset=excluded.ruleset
    AND battle_lineups.started_at=excluded.started_at AND battle_lineups.fireballs=excluded.fireballs
    AND battle_lineups.lineup=excluded.lineup
`;
const exportPage=`
  SELECT rowid AS cursor, battle_id AS battleId, run_id AS runId, round, seed,
    ruleset, started_at AS startedAt, fireballs, lineup, result, ticks
  FROM battle_lineups WHERE rowid > ? ORDER BY rowid LIMIT 128
`;

const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>typeof value==='number'&&
  Number.isSafeInteger(value)&&value>=min&&value<=max;

function isUnit(value:unknown):value is LineupUnit{
  if(!value||typeof value!=='object')return false;
  const u=value as Partial<Omit<LineupUnit,'tag'>>&{tag?:unknown};
  return Object.keys(u).every(key=>fields.has(key))&&typeof u.id==='string'&&unitIdPattern.test(u.id)&&
    typeof u.kind==='string'&&Object.hasOwn(units,u.kind)&&integer(u.atk)&&integer(u.hp,1)&&integer(u.armor)&&
    (u.tag===undefined||(typeof u.tag==='string'&&u.tag!=='remove'&&Object.hasOwn(magicTags,u.tag)))&&
    (u.cloneOf===undefined||(typeof u.cloneOf==='string'&&u.id===u.cloneOf+'-clone'&&u.tag===undefined));
}

function isLineupRecord(value:unknown):value is LineupRecord{
  if(!value||typeof value!=='object')return false;
  const row=value as Partial<LineupRecord>;
  if(typeof row.battleId!=='string'||!idPattern.test(row.battleId)||typeof row.runId!=='string'||!idPattern.test(row.runId)||
    !integer(row.round,1,encounters.length)||!integer(row.seed,0,0xffffffff)||!integer(row.ruleset,1)||
    !integer(row.startedAt,1)||!integer(row.fireballs)||
    (row.result===null?row.ticks!==null:!outcomes.has(row.result??'')||!integer(row.ticks,0,COMBAT.maxTicks)))return false;
  const {starters,reserves}=row.lineup??{};
  if(!Array.isArray(starters)||!starters.length||starters.length>2*FIELD_LIMIT||!Array.isArray(reserves)||
    !starters.every(isUnit)||!reserves.every(isUnit))return false;
  const roster=[...starters,...reserves];
  return new Set(roster.map(unit=>unit.id)).size===roster.length;
}

async function readBody(request:Request){
  const reader=request.body?.getReader();
  if(!reader)return;
  const decoder=new TextDecoder();
  let read=0,text='';
  for(;;){
    const {done,value}=await reader.read();
    if(done)return text+decoder.decode();
    read+=value.byteLength;
    if(read>limit){
      await reader.cancel();
      return;
    }
    text+=decoder.decode(value,{stream:true});
  }
}

function exportLineups(db:Database){
  const encoder=new TextEncoder();
  let cursor=0;
  const stream=new ReadableStream<Uint8Array>({
    async pull(controller){
      const {results}=await db.prepare(exportPage).bind(cursor).all<StoredRow>();
      for(const {cursor:row,lineup,...columns} of results){
        cursor=row;
        controller.enqueue(encoder.encode(JSON.stringify({...columns,lineup:JSON.parse(lineup)})+'\n'));
      }
      if(results.length<128)controller.close();
    },
  });
  return new Response(stream,{headers:{
    'content-type':'application/x-ndjson; charset=utf-8',
    'content-disposition':'attachment; filename="rollbound-lineups.ndjson"',
    'cache-control':'private, no-store',
  }});
}

export async function handleLineups(request:Request,env:LineupEnv):Promise<Response>{
  if(!request.headers.get('oai-authenticated-user-id'))return new Response('Sign-in required',{status:401});
  const db=env.DB;
  if(!db)return new Response('Lineup database unavailable',{status:503});
  if(request.method==='GET')return exportLineups(db);
  if(request.method!=='POST')return new Response(null,{status:405,headers:{allow:'GET, POST'}});
  if(request.headers.get('origin')!==new URL(request.url).origin)return new Response(null,{status:403});
  const contentType=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(contentType!=='application/json')return new Response(null,{status:415});
  let record:unknown;
  try{
    const body=await readBody(request);
    if(body===undefined)return new Response(null,{status:413});
    record=JSON.parse(body);
  }catch{return new Response(null,{status:400});}
  if(!isLineupRecord(record))return new Response(null,{status:400});
  const {battleId,runId,round,seed,ruleset,startedAt,fireballs,lineup,result,ticks}=record;
  const {starters,reserves}=lineup;
  const serialized=JSON.stringify({starters,reserves});
  await db.prepare(insert).bind(battleId,runId,round,seed,ruleset,startedAt,fireballs,serialized,result,ticks).run();
  return new Response(null,{status:204});
}
