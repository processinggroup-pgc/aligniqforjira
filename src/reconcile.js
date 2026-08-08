import api, { fetch, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { jiraIssue } from './sync';

const CONFIG_KEY = 'planforge-connection';
const TOKEN_KEY = 'planforge-connection-token';

const remoteRequest = async (connection, token, path, options = {}) => {
  const response = await fetch(`${connection.baseUrl}${path}`, {
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
      // The HTTP status remains useful when the response has no JSON body.
    }
    throw new Error(message);
  }
  return response;
};

const jiraError = async (response) => {
  try {
    const body = await response.json();
    const messages = [...(body.errorMessages || []), ...Object.values(body.errors || {})];
    if (messages.length) return messages.join(' ');
  } catch {
    // Jira link operations often return an intentionally empty response body.
  }
  return `Jira returned status ${response.status}.`;
};

const issueLinkTypes = async () => {
  const response = await api.asApp().requestJira(route`/rest/api/3/issueLinkType`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(await jiraError(response));
  const body = await response.json();
  return body.issueLinkTypes || [];
};

const locateLinkId = async (sourceIssueKey, targetIssueKey, linkType) => {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/issue/${sourceIssueKey}?fields=issuelinks`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error(await jiraError(response));
  const issue = await response.json();
  const link = (issue.fields?.issuelinks || []).find((candidate) => {
    const linkedKey = candidate.inwardIssue?.key || candidate.outwardIssue?.key;
    return linkedKey === targetIssueKey && candidate.type?.name?.toLowerCase() === linkType.toLowerCase();
  });
  if (!link?.id) throw new Error('Jira created the relationship but its link identifier could not be confirmed.');
  return String(link.id);
};

const createLink = async (payload) => {
  const sourceIssueKey = String(payload.sourceIssueKey || '').trim().toUpperCase();
  const targetIssueKey = String(payload.targetIssueKey || '').trim().toUpperCase();
  const linkTypeName = String(payload.linkType || 'Blocks');
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(sourceIssueKey) || !/^[A-Z][A-Z0-9_]*-\d+$/.test(targetIssueKey)) {
    throw new Error('The AlignIQ dependency does not contain two valid Jira issue keys.');
  }
  if (sourceIssueKey === targetIssueKey) throw new Error('A Jira issue cannot depend on itself.');

  const types = await issueLinkTypes();
  const linkType = types.find((candidate) => candidate.name?.toLowerCase() === linkTypeName.toLowerCase());
  if (!linkType) throw new Error(`The Jira “${linkTypeName}” link type is not enabled.`);

  /*
   * A AlignIQ dependency reads “source is blocked by target.” Jira represents
   * that sentence by placing the target on the inward side and the source on
   * the outward side of the native Blocks relationship.
   */
  const response = await api.asApp().requestJira(route`/rest/api/3/issueLink`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inwardIssue: { key: targetIssueKey },
      outwardIssue: { key: sourceIssueKey },
      type: { name: linkType.name },
    }),
  });
  if (!response.ok) throw new Error(await jiraError(response));
  return locateLinkId(sourceIssueKey, targetIssueKey, linkType.name);
};

const deleteLink = async (payload) => {
  const jiraLinkId = String(payload.jiraLinkId || '').trim();
  if (!/^\d+$/.test(jiraLinkId)) throw new Error('The Jira link identifier is invalid.');
  const response = await api.asApp().requestJira(route`/rest/api/3/issueLink/${jiraLinkId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  // A missing link is already in the desired deleted state, so retries remain idempotent.
  if (!response.ok && response.status !== 404) throw new Error(await jiraError(response));
  return jiraLinkId;
};

const acknowledge = async (connection, token, command, result) => {
  await remoteRequest(connection, token, '/api/integrations/jira/commands', {
    method: 'POST',
    body: JSON.stringify({ clientId: connection.clientId, commandId: command.id, ...result }),
  });
};

const reconcileIssue = async (connection, token, issueKey) => {
  const issue = await jiraIssue(issueKey);
  await remoteRequest(connection, token, '/api/integrations/jira/events', {
    method: 'POST',
    body: JSON.stringify({
      clientId: connection.clientId,
      eventType: 'planforge:reconciled:issue',
      cloudId: connection.cloudId,
      siteUrl: connection.siteUrl,
      occurredAt: new Date().toISOString(),
      issue,
    }),
  });
};

export const run = async () => {
  const connection = await kvs.get(CONFIG_KEY);
  const token = await kvs.getSecret(TOKEN_KEY);
  if (!connection || !token || connection.status !== 'connected') return;

  const response = await remoteRequest(
    connection,
    token,
    `/api/integrations/jira/commands?clientId=${encodeURIComponent(connection.clientId)}`,
  );
  const body = await response.json();
  const commands = body.commands || [];
  for (const command of commands) {
    try {
      let jiraLinkId = null;
      if (command.command_type === 'create_link') jiraLinkId = await createLink(command.payload);
      else if (command.command_type === 'delete_link') jiraLinkId = await deleteLink(command.payload);
      else throw new Error(`Unsupported AlignIQ command: ${command.command_type}`);
      await acknowledge(connection, token, command, { ok: true, jiraLinkId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Jira synchronization error';
      console.error('AlignIQ command failed', { commandId: command.id, message });
      await acknowledge(connection, token, command, { ok: false, error: message });
    }
  }

  /*
   * Once per hour, AlignIQ returns the Jira keys it already tracks. Refreshing
   * those snapshots repairs a missed status event without scanning unrelated
   * customer projects or widening the app's Jira permissions.
   */
  for (const issueKey of body.trackedIssues || []) {
    try {
      await reconcileIssue(connection, token, issueKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
      console.warn('AlignIQ issue reconciliation failed', { issueKey, message });
    }
  }

  if (commands.length || (body.trackedIssues || []).length) {
    await kvs.set(CONFIG_KEY, { ...connection, status: 'connected', lastSyncAt: new Date().toISOString(), lastError: null });
  }
};
