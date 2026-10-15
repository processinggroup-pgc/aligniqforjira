import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=async()=>(await readFile(new URL('../src/team-board-sync.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const route=(strings,...values)=>strings.reduce((text,part,index)=>text+part+(values[index]??''),'');
async function setup({ignored=false,tooLarge=false}={}){
 const paths=[],posted=[],writes=[];const connection={clientId:'todyl',cloudId:'cloud',baseUrl:'https://app.example',boards:[{id:302,name:'Core'}]};
 const api={asApp:()=>({requestJira:async path=>{paths.push(path);let body;
  if(path.includes('changelog'))body={issueChangeLogs:[{issueId:'1',changeHistories:[{id:'h1',created:'2026-10-01T12:00:00Z',items:[{fieldId:'status',fromString:'In progress',toString:'Done'}]}]}]};
  else body={total:tooLarge?5001:1,issues:tooLarge?[]:[{id:'1',key:'NEW-1',fields:{summary:'Agent feature',status:{name:'Done'},project:{key:'NEW'},points:3,sprints:[{name:'Old',state:'closed'},{name:'Sprint 48.1',state:'active'}]}}]};
  return {ok:true,json:async()=>body};}})};
 const kvs={get:async()=>connection,set:async(key,value)=>writes.push(value)};
 const fetch=async(url,options)=>{posted.push(JSON.parse(options.body));return {ok:true,json:async()=>({imported:1,ignored})}};
 const listTeamBoards=async()=>({boards:[{id:303,name:'Agent Pod Board'},{id:304,name:'AIML Board'},{id:999,name:'Billing'}]});
 const discoverPlanningFields=async()=>({storyPoints:'points',sprint:'sprints'});
 const sync=new Function('api','fetch','route','kvs','listTeamBoards','discoverPlanningFields',await source()+';return syncApprovedTeamBoard;')(api,fetch,route,kvs,listTeamBoards,discoverPlanningFields);
 return {sync,connection,paths,posted,writes};
}
test('first team import fetches board work and history instead of only already-tracked issues',async()=>{
 const state=await setup();const result=await state.sync(state.connection,'token',{includedTeams:['Agent Pod Board','AIML Board'],boards:[]});
 assert.equal(result.imported,true);assert.equal(result.board,'Agent Pod Board');assert.ok(state.paths[0].includes('/board/303/issue'));
 const payload=state.posted[0];assert.equal(payload.board.teamName,'Agent Pod Board');assert.equal(payload.issues[0].sprint,'Sprint 48.1');assert.equal(payload.issues[0].storyPoints,3);assert.equal(payload.histories[0].eventKey,'jira-history:NEW-1:h1');assert.equal(payload.users,undefined);assert.equal(state.writes[0].boards.length,2);
});
test('removed, unapproved, inactive and other-client boards cannot be imported',async()=>{
 const state=await setup();assert.equal((await state.sync({...state.connection,clientId:'other'},'token',{includedTeams:['Billing']})).imported,false);
 assert.equal((await state.sync(state.connection,'token',{includedTeams:[]})).imported,false);assert.equal(state.paths.length,0);
 const result=await state.sync(state.connection,'token',{includedTeams:['Agent Pod Board','AIML Board'],boards:[{name:'Agent Pod Board',active:false}]},'Billing');assert.equal(result.board,'AIML Board');assert.ok(state.paths.every(path=>!path.includes('/board/999/')));
});
test('recently synchronized teams wait, while a newly selected team can be imported immediately',async()=>{
 const state=await setup(),scope={includedTeams:['Agent Pod Board'],boards:[{name:'Agent Pod Board',active:true,lastSyncedAt:new Date().toISOString()}]};
 assert.equal((await state.sync(state.connection,'token',scope)).imported,false);assert.equal(state.posted.length,0);
 assert.equal((await state.sync(state.connection,'token',scope,'Agent Pod Board')).imported,true);
});
test('a removal during an import and an oversized board do not register or partially import a team',async()=>{
 const state=await setup({ignored:true});assert.equal((await state.sync(state.connection,'token',{includedTeams:['Agent Pod Board'],boards:[]})).imported,false);assert.equal(state.writes.length,0);
 const large=await setup({tooLarge:true});await assert.rejects(large.sync(large.connection,'token',{includedTeams:['Agent Pod Board'],boards:[]}),/5,000/);assert.equal(large.posted.length,0);
});
