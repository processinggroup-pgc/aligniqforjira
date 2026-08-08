# AlignIQ for Jira

The AlignIQ Forge app keeps Jira as the system of record while providing delivery leaders with a multi-team planning and forecasting workspace.

## Jira capabilities

- Native issue panel to view and create `Blocks` relationships
- Jira administrator connection and one-time token handshake
- Multiple Jira Software board import with explicit AlignIQ team mapping
- Issue-link and issue-update events sent to the client-isolated AlignIQ API
- Recoverable command queue for links created or removed from AlignIQ
- Five-minute reconciliation for tracked Jira issues
- Marketplace license context sent during the authenticated handshake

## Verification and deployment

Run Forge commands from this directory. Validate before deployment:

```text
forge lint
forge deploy --non-interactive --e development
```

Install or upgrade the development app only after the corresponding AlignIQ database migration and web deployment are available.

The production remote is restricted to `https://planforge-velopde.vercel.app`. Connection tokens are stored with Forge secret storage and are never returned to the UI.

## GitHub deployment

Every pull request and push to `main` runs source linting and `forge lint`. A successful push to `main` also deploys the development environment when these encrypted GitHub environment secrets are configured under the `development` environment:

- `FORGE_EMAIL`: the email address associated with the Atlassian developer account
- `FORGE_API_TOKEN`: an active Atlassian API scoped token authorized for Forge

Production promotion remains manual until Marketplace release controls are established.
