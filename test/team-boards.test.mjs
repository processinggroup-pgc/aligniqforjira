import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,timingSafeEqual} from 'node:crypto';
const source=async path=>(await readFile(new URL('../'+path,import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const route=(strings,...values)=>strings.reduce((text,part,index)=>text+part+(values[index]??''),'');
test('Jira team discovery paginates and restricts choices to boards located in New Engineering',async()=>{
 const paths=[];const api={asApp:()=>({requestJira:async path=>{paths.push(path);let body;
  if(path.includes('/project/'))body={id:'10001',key:'NEW',name:'New Engineering'};
  else if(path.includes('startAt=0'))body={values:[{id:302,name:'Core Pod',location:{projectId:10001}},{id:999,name:'Billing',location:{projectId:99999}}],total:3,isLast:false};
  else body={values:[{id:303,name:'Empty Pod',location:{projectKey:'NEW'}}],total:3,isLast:true};
  return {ok:true,json:async()=>body};}})};
 const list=new Function('api','route',await source('src/team-boards.js')+';return listTeamBoards;')(api,route);
 const result=await list({clientId:'todyl'},'NEW');assert.equal(result.projectName,'New Engineering');assert.deepEqual(result.boards.map(board=>board.name),['Core Pod','Empty Pod']);assert.ok(paths.at(-1).includes('startAt=2'));assert.ok(paths.slice(1).every(path=>path.includes('projectKeyOrId=NEW')));
});
test('board discovery web trigger checks installation secret and client before querying Jira',async()=>{
 let queried=0,reconciled=0;const kvs={getSecret:async()=> 'secret',get:async()=>({clientId:'todyl',status:'connected'})};
 const run=new Function('kvs','createHash','timingSafeEqual','listTeamBoards','reconcile',await source('src/refresh.js')+';return run;')(kvs,createHash,timingSafeEqual,async(connection,project)=>{queried++;assert.equal(project,'NEW');return {projectKey:'NEW',boards:[]}},async()=>{reconciled++});
 const token=createHash('sha256').update('secret:aligniq-instant-sync').digest('hex');
 assert.equal((await run({method:'POST',body:JSON.stringify({action:'listTeamBoards',clientId:'todyl'})})).statusCode,401);
 const request=clientId=>({method:'POST',headers:{authorization:[`Bearer ${token}`]},body:JSON.stringify({action:'listTeamBoards',clientId})});
 assert.equal((await run(request('other'))).statusCode,403);assert.equal(queried,0);
 assert.equal((await run(request('todyl'))).statusCode,200);assert.equal(queried,1);assert.equal(reconciled,0);
});
