import { run as reconcile } from './reconcile';

export const run = async (request) => {
  if (request?.method && request.method !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    await reconcile();
    return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ ok: true, synchronizedAt: new Date().toISOString() }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Immediate Jira synchronization failed';
    console.error('AlignIQ immediate synchronization failed', { message });
    return { statusCode: 502, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: message }) };
  }
};
