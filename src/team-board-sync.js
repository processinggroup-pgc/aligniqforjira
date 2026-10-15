import api, { fetch, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { listTeamBoards } from './team-boards';
import { discoverPlanningFields } from './sync';

const read = async (path, options = {}) => {
  const response = await api.asApp().requestJira(path, { ...options, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
  if (!response.ok) throw new Error(`Jira team board read failed (${response.status}).`);
  return response.json().catch(()=>{throw new Error(`Jira returned an empty JSON response (${response.status}) for ${String(path).split('?')[0]}`)});
};
const sprintName = value => {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const selected = [...values].reverse().find(sprint => sprint?.state === 'active') || [...values].reverse().find(sprint => sprint?.state === 'future') || values.at(-1);
  return typeof selected === 'object' ? selected?.name || null : String(selected || '').match(/(?:^|,)name=([^,]+)/)?.[1] || null;
};

// Process one bounded chunk from an approved board per invocation so the scheduled trigger and the
// immediate web trigger stay within their execution budgets. Missing imports
// take priority; persistent cursors let subsequent runs finish large boards safely.
export async function syncApprovedTeamBoard(connection, token, scope, preferredTeam) {
  if (connection.clientId !== 'todyl' || !scope?.includedTeams?.length) return { imported: false };
  const directory = await listTeamBoards(connection, 'NEW');
  const progressKey='todyl-team-board-import-progress';
  const progress=await kvs.get(progressKey)||{};
  const approved = new Set(scope.includedTeams);
  const candidates = directory.boards.filter(board => approved.has(board.name)).map(board => ({ board, state: scope.boards?.find(saved => saved.name === board.name) })).filter(entry => entry.state?.active !== false);
  candidates.sort((a, b) => (Date.parse(a.state?.lastSyncedAt || '') || 0) - (Date.parse(b.state?.lastSyncedAt || '') || 0));
  const target = candidates.find(entry => entry.board.name === preferredTeam) || candidates.find(entry => progress[String(entry.board.id)] || !entry.state?.lastSyncedAt || Date.now() - Date.parse(entry.state.lastSyncedAt) >= 15 * 60000);
  if (!target) return { imported: false };
  const board = target.board;
  const fields = await discoverPlanningFields();
  const requestedFields = ['summary', 'issuetype', 'status', 'assignee', 'project', 'updated', fields.storyPoints, fields.sprint].filter(Boolean).join(',');
  const rawIssues = [];
  const initialOffset=Number(progress[String(board.id)]?.nextStart||0);
  let total = 0;
  for (let startAt = initialOffset; rawIssues.length < 300;) {
    const page = await read(route`/rest/agile/1.0/board/${board.id}/issue?startAt=${startAt}&maxResults=100&fields=${requestedFields}`);
    const values = page.issues || []; rawIssues.push(...values); total = Number(page.total ?? rawIssues.length); startAt += values.length;
    if (!values.length || startAt >= total) break;
  }
  const processed=initialOffset+rawIssues.length,complete=processed>=total||!rawIssues.length;
  const issues = rawIssues.map(issue => ({ id: String(issue.id), key: issue.key, summary: issue.fields?.summary || issue.key, issueType: issue.fields?.issuetype?.name || 'Story', status: issue.fields?.status?.name || 'Unknown', statusCategory: issue.fields?.status?.statusCategory?.name || null, assignee: issue.fields?.assignee?.displayName || null, assigneeAccountId: issue.fields?.assignee?.accountId || null, projectKey: issue.fields?.project?.key || null, projectName: issue.fields?.project?.name || null, updatedAt: issue.fields?.updated || null, storyPoints: fields.storyPoints ? issue.fields?.[fields.storyPoints] ?? null : null, sprint: fields.sprint ? sprintName(issue.fields?.[fields.sprint]) : null }));
  const sampled = issues.slice(-1000), byId = new Map(sampled.map(issue => [issue.id, issue])), histories = [];
  let nextPageToken;
  for (let page = 0; sampled.length && page < 10; page++) {
    const result = await read(route`/rest/api/3/changelog/bulkfetch`, { method: 'POST', body: JSON.stringify({ issueIdsOrKeys: sampled.map(issue => issue.key), fieldIds: ['status'], maxResults: 1000, ...(nextPageToken ? { nextPageToken } : {}) }) });
    for (const log of result.issueChangeLogs || []) {
      const issue = byId.get(String(log.issueId)); if (!issue) continue;
      for (const change of log.changeHistories || []) {
        const status = (change.items || []).find(item => item.fieldId === 'status' || String(item.field || '').toLowerCase() === 'status'); if (!status) continue;
        const time = change.created, occurredAt = new Date(typeof time === 'number' ? time * (time < 100000000000 ? 1000 : 1) : time).toISOString();
        histories.push({ eventKey: `jira-history:${issue.key}:${change.id}`, itemKey: issue.key, fromStatus: status.fromString || null, toStatus: status.toString || null, occurredAt, projectKey: issue.projectKey, projectName: issue.projectName, sprint: issue.sprint, storyPoints: issue.storyPoints });
      }
    }
    nextPageToken = result.nextPageToken; if (!nextPageToken || histories.length >= 10000) break;
  }
  // This is a read-only Jira import. The existing client-scoped intake endpoint
  // checks the current approved teams again before saving any records.
  let saved=0;
  const batches=[{issues,histories:[]}];
  for(let index=0;index<histories.length;index+=500)batches.push({issues:[],histories:histories.slice(index,index+500)});
  for(const batch of batches){
    const response=await fetch(`${connection.baseUrl}/api/integrations/jira/board`,{method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({clientId:connection.clientId,cloudId:connection.cloudId,board:{id:board.id,name:board.name,type:board.type,teamName:board.name},...batch})});
    const text=await response.text();let result;
    try{result=JSON.parse(text)}catch{throw new Error(`AlignIQ board import returned an empty or invalid response (HTTP ${response.status}) for ${board.name}`)}
    if(!response.ok)throw new Error(result.error||`Team board import failed (${response.status}).`);
    if(result.ignored)return {imported:false,board:board.name,ignored:true};
    saved+=Number(result.imported||0);
  }
  const latestProgress=await kvs.get(progressKey)||{};
  if(complete){if(latestProgress[String(board.id)]){delete latestProgress[String(board.id)];await kvs.set(progressKey,latestProgress)}}
  else await kvs.set(progressKey,{...latestProgress,[String(board.id)]:{nextStart:processed,total}});
  const current = await kvs.get('planforge-connection') || connection, syncedAt = new Date().toISOString();
  await kvs.set('planforge-connection', { ...current, boards: [...(current.boards || []).filter(entry => Number(entry.id) !== board.id), { id: board.id, name: board.name, type: board.type, teamName: board.name, syncedAt }], lastSyncAt: syncedAt });
  return { imported: true, board: board.name, items: issues.length, saved, complete, processed, total, historyEvents: histories.length };
}
