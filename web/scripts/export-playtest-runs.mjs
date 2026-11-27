import {once} from 'node:events';

const {CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_API_TOKEN,ROLLBOUND_KV_NAMESPACE_ID}=process.env;
const identifier=/^[a-f0-9]{32}$/i;
if(!identifier.test(CLOUDFLARE_ACCOUNT_ID??'')||!identifier.test(ROLLBOUND_KV_NAMESPACE_ID??'')||!CLOUDFLARE_API_TOKEN){
  console.error('Set CLOUDFLARE_ACCOUNT_ID, ROLLBOUND_KV_NAMESPACE_ID and a Workers KV Storage Read CLOUDFLARE_API_TOKEN.');
  process.exit(1);
}

const root='https://api.cloudflare.com/client/v4/accounts/'+CLOUDFLARE_ACCOUNT_ID+'/storage/kv/namespaces/'+ROLLBOUND_KV_NAMESPACE_ID;
const headers={authorization:'Bearer '+CLOUDFLARE_API_TOKEN,'content-type':'application/json'};

async function callCloudflare(path,body){
  const response=await fetch(root+path,{
    method:body?'POST':'GET',headers,body,redirect:'error',signal:AbortSignal.timeout(30000),
  });
  if(!response.ok)throw Error('Cloudflare KV request failed (HTTP '+response.status+').');
  const data=await response.json();
  if(!data.success)throw Error('Cloudflare rejected the KV request.');
  return data;
}

let cursor='';
do{
  const query=new URLSearchParams({prefix:'run:',limit:'25'});
  if(cursor)query.set('cursor',cursor);
  const page=await callCloudflare('/keys?'+query);
  const keys=page.result.map(({name})=>name);
  if(keys.length){
    const {result:{values}}=await callCloudflare('/bulk/get',JSON.stringify({keys,type:'json'}));
    for(const key of keys){
      const run=values[key];
      if(run?.schemaVersion!==1||'run:'+run.runId!==key||!Array.isArray(run.battles)){
        throw Error('A run listed by KV is unavailable or has an invalid record format. Retry the export.');
      }
      if(!process.stdout.write(JSON.stringify(run)+'\n'))await once(process.stdout,'drain');
    }
  }
  const next=page.result_info?.cursor??'';
  if(next&&next===cursor)throw Error('Cloudflare returned the same cursor twice.');
  cursor=next;
}while(cursor);
