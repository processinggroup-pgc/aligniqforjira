import Resolver from '@forge/resolver';
import api, { fetch, route } from '@forge/api';
import { kvs } from '@forge/kvs';

const resolver = new Resolver();
const CONFIG_KEY = 'planforge-connection';
const TOKEN_KEY = 'planforge-connection-token';
const ALLOWED_PLANFORGE_ORIGIN = 'https://planforge-velopde.vercel.app';

const publicConnection = (connection) => {
  if (!connection) {
    return { connected: false, status: 'disconnected' };
  }

  return {
    connected: connection.status === 'connected',
    status: connection.status,
    baseUrl: connection.baseUrl,
    clientId: connection.clientId,
    siteUrl: connection.siteUrl,
    lastSyncAt: connection.lastSyncAt || null,
    lastEventAt: connection.lastEventAt || null,
    lastError: connection.lastError || null,
    boardId: connection.boardId || null,
    boardName: connection.boardName || null,
    boardType: connection.boardType || null,
    boardSyncedAt: connection.boardSyncedAt || null,
    boards: connection.boards || (connection.boardId ? [{ id: connection.boardId, name: connection.boardName, type: connection.boardType, teamName: connection.boardName, syncedAt: connection.boardSyncedAt }] : []),
    environmentId: connection.environmentId || null,
  };
};

const normalizedAlignIQUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Enter a valid AlignIQ URL.');
  }

  if (parsed.origin !== ALLOWED_PLANFORGE_ORIGIN) {
    throw new Error(`Use the production AlignIQ URL: ${ALLOWED_PLANFORGE_ORIGIN}`);
  }

  return parsed.origin;
};

const jiraSiteDetails = async (request) => {
  const response = await api.asUser().requestJira(route`/rest/api/3/serverInfo`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Jira site details could not be read (${response.status}).`);
  }

  const serverInfo = await response.json();
  const installationAri = request.context.installContext;
  const cloudId = installationAri?.split('/').pop();

  if (!cloudId) {
    throw new Error('The Jira installation identifier is unavailable.');
  }

  return {
    siteUrl: serverInfo.baseUrl,
    cloudId,
    installationAri,
    environmentId: request.context.environmentId,
    license: request.context.license || { isActive: true, type: 'DEVELOPMENT', capabilitySet: 'advanced' },
  };
};

const planForgeRequest = async (baseUrl, path, clientId, token, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `AlignIQ returned status ${response.status}.`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // A missing JSON error body should not hide the useful HTTP status.
    }
    throw new Error(message);
  }

  return response;
};

const requireJiraAdmin = async () => {
  const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Jira administrator access could not be verified (${response.status}).`);
  }
  const payload = await response.json();
  if (!payload.permissions?.ADMINISTER?.havePermission) {
    throw new Error('Jira administrator access is required to configure AlignIQ.');
  }
};

resolver.define('getConnection', async (request) => {
  await requireJiraAdmin();
  let connection = await kvs.get(CONFIG_KEY);
  const token = await kvs.getSecret(TOKEN_KEY);
  if (connection && token && connection.status === 'connected' && request.context.environmentId && connection.environmentId !== request.context.environmentId) {
    connection = { ...connection, environmentId: request.context.environmentId };
    await planForgeRequest(connection.baseUrl, '/api/integrations/jira/handshake', connection.clientId, token, {
      method: 'POST',
      body: JSON.stringify({ clientId: connection.clientId, siteUrl: connection.siteUrl, cloudId: connection.cloudId, installationAri: connection.installationAri, forgeEnvironmentId: connection.environmentId, license: connection.license }),
    });
    await kvs.set(CONFIG_KEY, connection);
  }
  return publicConnection(connection);
});

resolver.define('saveConnection', async (request) => {
  await requireJiraAdmin();
  const baseUrl = normalizedAlignIQUrl(request.payload?.baseUrl?.trim());
  const clientId = request.payload?.clientId?.trim();
  const token = request.payload?.token?.trim();

  if (!clientId || !/^[a-zA-Z0-9_-]+$/.test(clientId)) {
    throw new Error('Enter the AlignIQ client ID shown in the client Integrations tab.');
  }
  if (!token?.startsWith('pfi_') || token.length < 40) {
    throw new Error('Enter the complete one-time AlignIQ connection token.');
  }

  const site = await jiraSiteDetails(request);
  await planForgeRequest(baseUrl, '/api/integrations/jira/handshake', clientId, token, {
    method: 'POST',
    body: JSON.stringify({
      clientId,
      siteUrl: site.siteUrl,
      cloudId: site.cloudId,
      installationAri: site.installationAri,
      forgeEnvironmentId: site.environmentId,
      license: site.license,
    }),
  });

  /*
   * The raw token is stored only after the remote handshake succeeds. KVS
   * Secret encrypts the credential and prevents it from being returned to the
   * UI or included in ordinary Forge storage reads.
   */
  await kvs.setSecret(TOKEN_KEY, token);
  const connection = {
    baseUrl,
    clientId,
    ...site,
    status: 'connected',
    lastSyncAt: new Date().toISOString(),
    lastEventAt: null,
    lastError: null,
  };
  await kvs.set(CONFIG_KEY, connection);
  return publicConnection(connection);
});

const jiraJson = async (path) => {
  const response = await api.asUser().requestJira(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Jira returned status ${response.status}.`);
  return response.json();
};

resolver.define('listBoards', async () => {
  await requireJiraAdmin();
  const connection = await kvs.get(CONFIG_KEY);
  if (!connection || connection.status !== 'connected') throw new Error('Connect AlignIQ before choosing a board.');
  const boards=[];
  for(let startAt=0;startAt<1000;startAt+=100){
    const payload=await jiraJson(route`/rest/agile/1.0/board?startAt=${startAt}&maxResults=100&orderBy=name`);
    boards.push(...(payload.values||[]));
    if(payload.isLast||!payload.values?.length||boards.length>=Number(payload.total||0))break;
  }
  return boards.map((board) => ({ id: board.id, name: board.name, type: board.type, location: board.location?.displayName || board.location?.name || null }));
});

resolver.define('selectBoard', async (request) => {
  await requireJiraAdmin();
  const connection = await kvs.get(CONFIG_KEY);
  const token = await kvs.getSecret(TOKEN_KEY);
  const boardId = Number(request.payload?.boardId);
  const teamName=String(request.payload?.teamName||'').trim();
  if (!connection || !token || connection.status !== 'connected') throw new Error('Connect AlignIQ before choosing a board.');
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('Choose a valid Jira board.');
  const board = await jiraJson(route`/rest/agile/1.0/board/${boardId}`);
  const fields = await jiraJson(route`/rest/api/3/field`);
  const normalized = (value) => String(value || '').trim().toLowerCase();
  const storyPointsField = fields.find((field) => ['story points','story point estimate'].includes(normalized(field.name)))?.id;
  const sprintField = fields.find((field) => normalized(field.name) === 'sprint')?.id;
  const requestedFields = ['summary','status','assignee','project','updated',storyPointsField,sprintField].filter(Boolean).join(',');
  const allIssues=[];
  let boardIssueTotal=0;
  for(let startAt=0;startAt<5000;startAt+=100){
    const issuePayload=await jiraJson(route`/rest/agile/1.0/board/${boardId}/issue?startAt=${startAt}&maxResults=100&fields=${requestedFields}`);
    allIssues.push(...(issuePayload.issues||[]));
    boardIssueTotal=Number(issuePayload.total||allIssues.length);
    if(!issuePayload.issues?.length||allIssues.length>=Number(issuePayload.total||0))break;
  }
  if(boardIssueTotal>allIssues.length)throw new Error(`This board contains ${boardIssueTotal} issues. Narrow its Jira filter to 5,000 issues or fewer before importing.`);
  const sprintName = (value) => { const values = Array.isArray(value) ? value : value ? [value] : []; const sprint = [...values].reverse().find((candidate) => candidate && typeof candidate === 'object'); return sprint?.name || null; };
  const issues = allIssues.map((issue) => ({ id:String(issue.id),key: issue.key, summary: issue.fields?.summary || issue.key, status: issue.fields?.status?.name || 'Unknown', statusCategory: issue.fields?.status?.statusCategory?.name || null, assignee: issue.fields?.assignee?.displayName || null, projectKey: issue.fields?.project?.key || null, projectName: issue.fields?.project?.name || null, updatedAt: issue.fields?.updated || null, storyPoints: storyPointsField ? issue.fields?.[storyPointsField] ?? null : null, sprint: sprintField ? sprintName(issue.fields?.[sprintField]) : null }));
  const historyIssues=issues.slice(-1000);
  const issueById=new Map(historyIssues.map((issue)=>[issue.id,issue]));
  const histories=[];
  let nextPageToken;
  for(let page=0;historyIssues.length&&page<10;page+=1){
    const historyResponse=await api.asUser().requestJira(route`/rest/api/3/changelog/bulkfetch`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({issueIdsOrKeys:historyIssues.map((issue)=>issue.key),fieldIds:['status'],maxResults:1000,...(nextPageToken?{nextPageToken}:{})})});
    if(!historyResponse.ok)throw new Error(`Jira status history could not be read (${historyResponse.status}).`);
    const historyPayload=await historyResponse.json();
    for(const issueLog of historyPayload.issueChangeLogs||[]){const issue=issueById.get(String(issueLog.issueId));if(!issue)continue;for(const change of issueLog.changeHistories||[]){const statusChange=(change.items||[]).find((item)=>item.fieldId==='status'||String(item.field||'').toLowerCase()==='status');if(!statusChange)continue;const rawTime=change.created;const occurredAt=typeof rawTime==='number'?new Date(rawTime*(rawTime<100000000000?1000:1)).toISOString():new Date(rawTime).toISOString();histories.push({eventKey:`jira-history:${issue.key}:${change.id}`,itemKey:issue.key,fromStatus:statusChange.fromString||null,toStatus:statusChange.toString||null,occurredAt,projectKey:issue.projectKey,projectName:issue.projectName,sprint:issue.sprint,storyPoints:issue.storyPoints})}}
    nextPageToken=historyPayload.nextPageToken;if(!nextPageToken||histories.length>=10000)break;
  }
  const syncedAt=new Date().toISOString();
  await planForgeRequest(connection.baseUrl, '/api/integrations/jira/board', connection.clientId, token, { method: 'POST', body: JSON.stringify({ clientId: connection.clientId, cloudId: connection.cloudId, board: { id: board.id, name: board.name, type: board.type, teamName:teamName||board.name }, issues, histories }) });
  const existingBoards=connection.boards||[];
  const boards=[...existingBoards.filter((candidate)=>Number(candidate.id)!==board.id),{id:board.id,name:board.name,type:board.type,teamName:teamName||board.name,syncedAt}];
  const next = { ...connection, boardId: board.id, boardName: board.name, boardType: board.type, boardSyncedAt: syncedAt, boards, lastSyncAt: syncedAt, lastError: null };
  await kvs.set(CONFIG_KEY, next);
  return { connection: publicConnection(next), imported: issues.length, historyEvents:histories.length };
});

resolver.define('removeBoard',async(request)=>{
  await requireJiraAdmin();
  const connection=await kvs.get(CONFIG_KEY);
  if(!connection||connection.status!=='connected')throw new Error('Connect AlignIQ before changing boards.');
  const boardId=Number(request.payload?.boardId);
  const boards=(connection.boards||[]).filter((candidate)=>Number(candidate.id)!==boardId);
  const latest=boards.at(-1);
  const next={...connection,boards,boardId:latest?.id||null,boardName:latest?.name||null,boardType:latest?.type||null,boardSyncedAt:latest?.syncedAt||null};
  await kvs.set(CONFIG_KEY,next);
  return publicConnection(next);
});

resolver.define('disconnectConnection', async () => {
  await requireJiraAdmin();
  const connection = await kvs.get(CONFIG_KEY);
  const token = await kvs.getSecret(TOKEN_KEY);

  if (connection && token) {
    try {
      await planForgeRequest(
        connection.baseUrl,
        '/api/integrations/jira/handshake',
        connection.clientId,
        token,
        {
          method: 'DELETE',
          body: JSON.stringify({ clientId: connection.clientId }),
        },
      );
    } catch (error) {
      console.warn('AlignIQ could not confirm the disconnect', error);
    }
  }

  await Promise.all([kvs.delete(CONFIG_KEY), kvs.deleteSecret(TOKEN_KEY)]);
  return { connected: false, status: 'disconnected' };
});

export const handler = resolver.getDefinitions();
