import { run as reconcile } from './reconcile';
import { kvs } from '@forge/kvs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { listTeamBoards } from './team-boards';
import { syncApprovedTeamBoard } from './team-board-sync';
import { fetch } from '@forge/api';

const TOKEN_KEY = 'planforge-connection-token';

async function authorized(request) {
  const token = await kvs.getSecret(TOKEN_KEY);
  const supplied = request?.headers?.authorization?.[0] ?? request?.headers?.Authorization?.[0] ?? '';
  const expected = token ? createHash('sha256').update(`${token}:aligniq-instant-sync`).digest('hex') : '';
  const received = supplied.startsWith('Bearer ') ? supplied.slice(7).trim() : '';
  const left = Buffer.from(expected); const right = Buffer.from(received);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export const run = async (request) => {
  if (request?.method && request.method !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!await authorized(request)) return { statusCode: 401, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: 'Unauthorized' }) };
  try {
    const body = request?.body ? JSON.parse(request.body) : {};
    if (body.action === 'listTeamBoards' || body.action === 'syncTeamBoards') {
      const connection = await kvs.get('planforge-connection');
      if (!connection || connection.status !== 'connected' || connection.clientId !== body.clientId || connection.clientId !== 'todyl') {
        return { statusCode: 403, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: 'This Jira installation belongs to a different client.' }) };
      }
      if(body.action==='syncTeamBoards'){
        const token=await kvs.getSecret(TOKEN_KEY);
        const response=await fetch(`${connection.baseUrl}/api/integrations/jira/commands?clientId=${encodeURIComponent(connection.clientId)}&boardsOnly=true`,{headers:{Authorization:`Bearer ${token}`}});
        if(!response.ok)throw new Error('Approved Jira team scope could not be read');
        const scope=await response.json();const result=await syncApprovedTeamBoard(connection,token,scope.teamBoardSync,body.preferredTeam);
        return {statusCode:200,headers:{'Content-Type':['application/json']},body:JSON.stringify({ok:true,...result})};
      }
      const result = await listTeamBoards(connection, 'NEW');
      return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ ok: true, ...result }) };
    }
    await reconcile();
    return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ ok: true, synchronizedAt: new Date().toISOString() }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Immediate Jira synchronization failed';
    console.error('AlignIQ immediate synchronization failed', { message });
    return { statusCode: 502, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: message }) };
  }
};
