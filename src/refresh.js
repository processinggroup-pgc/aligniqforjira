import { run as reconcile } from './reconcile';
import { kvs } from '@forge/kvs';
import { createHash, timingSafeEqual } from 'node:crypto';

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
    await reconcile();
    return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ ok: true, synchronizedAt: new Date().toISOString() }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Immediate Jira synchronization failed';
    console.error('AlignIQ immediate synchronization failed', { message });
    return { statusCode: 502, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: message }) };
  }
};
