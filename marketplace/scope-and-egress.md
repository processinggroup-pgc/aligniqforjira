# Scope and egress justification

## Jira scopes

- `read:jira-work`: read selected issue fields, issue links, status, and metadata needed for planning synchronization.
- `write:jira-work`: create and remove native Jira issue links explicitly requested by an authorized user.
- `read:board-scope:jira-software`: list Jira Software boards for an administrator to select.
- `read:project:jira`: identify the projects behind selected boards.
- `read:sprint:jira-software`: read sprint membership and history for delivery-flow evidence.
- `read:issue-details:jira`: read issue details returned by selected board queries.
- `read:jql:jira`: support bounded Jira issue discovery used by the integration.
- `storage:app`: store the encrypted AlignIQ connection credential and non-secret connection configuration in Forge storage.

The configuration screen is a `jira:adminPage` and verifies Jira `ADMINISTER` permission before connection or board changes. No global page is used.

## External egress

Forge sends tenant-scoped planning events and commands to `https://aligniq-velopde.vercel.app`, the production AlignIQ service. The former `https://planforge-velopde.vercel.app` endpoint is temporarily allow-listed for migration only. The request uses the client ID and an encrypted per-installation bearer token. No general internet egress is declared.

Before Marketplace submission, replace the legacy host label with the final AlignIQ domain in the manifest and this document.
