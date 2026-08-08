import api, { fetch, route } from '@forge/api';
import { kvs } from '@forge/kvs';

const CONFIG_KEY = 'planforge-connection';
const TOKEN_KEY = 'planforge-connection-token';
const FIELD_CONFIG_KEY = 'planforge-jira-fields';
const ALIGNIQ_ORIGIN = 'https://aligniq-velopde.vercel.app';
const LEGACY_PLANFORGE_ORIGIN = 'https://planforge-velopde.vercel.app';

const discoverPlanningFields = async () => {
  const cached = await kvs.get(FIELD_CONFIG_KEY);
  if (cached) return cached;
  const response = await api.asApp().requestJira(route`/rest/api/3/field`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return { storyPoints: null, sprint: null };
  const fields = await response.json();
  const normalized = (value) => String(value || '').trim().toLowerCase();
  const storyPoints = fields.find((field) => ['story points', 'story point estimate'].includes(normalized(field.name)));
  const sprint = fields.find((field) => normalized(field.name) === 'sprint');
  const configuration = { storyPoints: storyPoints?.id || null, sprint: sprint?.id || null };
  await kvs.set(FIELD_CONFIG_KEY, configuration);
  return configuration;
};

const sprintName = (value) => {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const selected = [...entries].reverse().find((entry) => entry?.state === 'active') || entries.at(-1);
  if (typeof selected === 'object') return selected?.name || null;
  const legacyName = String(selected || '').match(/(?:^|,)name=([^,]+)/)?.[1];
  return legacyName || null;
};

export const jiraIssue = async (issueId) => {
  const planningFields = await discoverPlanningFields();
  const requestedFields = ['summary', 'status', 'assignee', 'project', 'updated', planningFields.storyPoints, planningFields.sprint].filter(Boolean).join(',');
  const response = await api
    .asApp()
    .requestJira(
      route`/rest/api/3/issue/${issueId}?fields=${requestedFields}`,
      { headers: { Accept: 'application/json' } },
    );

  if (!response.ok) {
    throw new Error(`Jira issue ${issueId} could not be read (${response.status}).`);
  }

  const issue = await response.json();
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields?.summary || issue.key,
    status: issue.fields?.status?.name || 'Unknown',
    statusCategory: issue.fields?.status?.statusCategory?.key || 'new',
    assignee: issue.fields?.assignee?.displayName || 'Unassigned',
    projectKey: issue.fields?.project?.key || null,
    projectName: issue.fields?.project?.name || null,
    storyPoints: planningFields.storyPoints && Number.isFinite(Number(issue.fields?.[planningFields.storyPoints])) ? Number(issue.fields[planningFields.storyPoints]) : null,
    sprint: planningFields.sprint ? sprintName(issue.fields?.[planningFields.sprint]) : null,
    updatedAt: issue.fields?.updated || new Date().toISOString(),
  };
};

const updateLocalConnection = async (connection, patch) => {
  await kvs.set(CONFIG_KEY, { ...connection, ...patch });
};

export const run = async (event) => {
  let connection = await kvs.get(CONFIG_KEY);
  const token = await kvs.getSecret(TOKEN_KEY);

  /*
   * Existing installations should not need an administrator to revisit the
   * settings screen after the product-domain migration. The first ordinary
   * Jira event upgrades the stored destination before sending any data.
   */
  if (connection?.baseUrl === LEGACY_PLANFORGE_ORIGIN) {
    connection = { ...connection, baseUrl: ALIGNIQ_ORIGIN };
    await kvs.set(CONFIG_KEY, connection);
  }

  // Jira-only mode is intentionally useful without a AlignIQ connection.
  if (!connection || !token || connection.status !== 'connected') {
    return;
  }

  try {
    // Issue updates are intentionally sent only as status snapshots. AlignIQ
    // decides whether the issue is already part of its planning graph and safely
    // ignores unrelated Jira work, keeping this broad Jira event low-noise.
    if (event.eventType === 'avi:jira:updated:issue') {
      const issueId = event.issue?.id || event.issue?.key;
      if (!issueId) {
        return;
      }
      const issue = await jiraIssue(issueId);
      const occurredAt = issue.updatedAt || new Date().toISOString();
      const response = await fetch(`${connection.baseUrl}/api/integrations/jira/events`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: connection.clientId,
          eventType: event.eventType,
          cloudId: connection.cloudId,
          siteUrl: connection.siteUrl,
          selfGenerated: event.selfGenerated,
          occurredAt,
          issue,
        }),
      });

      if (!response.ok) {
        let message = `AlignIQ returned status ${response.status}.`;
        try {
          const body = await response.json();
          message = body.error || message;
        } catch {
          // Preserve the HTTP status when the remote response contains no JSON.
        }
        throw new Error(message);
      }

      await updateLocalConnection(connection, {
        status: 'connected',
        lastSyncAt: occurredAt,
        lastEventAt: occurredAt,
        lastError: null,
      });
      return;
    }

    // Link events contain only identifiers, so resolve both issues from Jira to
    // give AlignIQ a complete and current planning snapshot for each endpoint.
    const [sourceIssue, destinationIssue] = await Promise.all([
      jiraIssue(event.sourceIssueId),
      jiraIssue(event.destinationIssueId),
    ]);
    const occurredAt = new Date().toISOString();
    const response = await fetch(`${connection.baseUrl}/api/integrations/jira/events`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: connection.clientId,
        eventType: event.eventType,
        linkId: event.id,
        cloudId: connection.cloudId,
        siteUrl: connection.siteUrl,
        selfGenerated: event.selfGenerated,
        occurredAt,
        linkType: event.issueLinkType,
        sourceIssue,
        destinationIssue,
      }),
    });

    if (!response.ok) {
      let message = `AlignIQ returned status ${response.status}.`;
      try {
        const body = await response.json();
        message = body.error || message;
      } catch {
        // Preserve the status-based message when the response has no JSON body.
      }
      throw new Error(message);
    }

    await updateLocalConnection(connection, {
      status: 'connected',
      lastSyncAt: occurredAt,
      lastEventAt: occurredAt,
      lastError: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown synchronization error';
    console.error('AlignIQ Jira issue-link synchronization failed', error);
    await updateLocalConnection(connection, {
      status: 'error',
      lastError: message,
    });
    throw error;
  }
};
