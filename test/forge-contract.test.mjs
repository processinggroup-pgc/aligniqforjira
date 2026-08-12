import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('declares the minimum Jira and remote integration controls', async () => {
  const [manifest, resolver] = await Promise.all([source('manifest.yml'), source('src/resolvers/index.js')]);
  assert.match(manifest, /jira:adminPage:/);
  assert.match(manifest, /jira:globalPage:/);
  assert.match(manifest, /key: aligniq-global-page/);
  assert.match(manifest, /licensing:\s*\n\s*enabled: true/);
  assert.match(manifest, /baseUrl: https:\/\/aligniq-velopde\.vercel\.app/);
  assert.match(manifest, /baseUrl: https:\/\/planforge-velopde\.vercel\.app/);
  assert.match(resolver, /requireJiraAdmin/);
  assert.match(resolver, /kvs\.setSecret\(TOKEN_KEY, token\)/);
  assert.match(manifest, /- read:jira-user/);
  assert.match(resolver, /user\/assignable\/multiProjectSearch/);
  assert.match(resolver, /assigneeAccountId/);
});

test('refreshes cached Marketplace licensing and dispatches idempotent Jira commands', async () => {
  const reconcile = await source('src/reconcile.js');
  assert.match(reconcile, /requestAtlassian\(route`\/forge\/app\/v1\/license`/);
  assert.match(reconcile, /LICENSE_REFRESH_MS/);
  assert.match(reconcile, /response\.status === 429/);
  assert.match(reconcile, /if \(!response\.ok && response\.status !== 404\)/);
  assert.match(reconcile, /Unsupported AlignIQ command/);
  assert.match(reconcile, /command\.command_type === 'update_issue'/);
  assert.match(reconcile, /issue\/\$\{issueKey\}\/assignee/);
  assert.match(reconcile, /discoverPlanningFields/);
  assert.match(reconcile, /reconcileIssue\(connection, token, issueKey\)/);
});
