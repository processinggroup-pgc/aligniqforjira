# Marketplace release checklist

## Blocking before production promotion

- [ ] Apply web database migrations 009 and 010 in Supabase production.
- [ ] Add `CRON_SECRET` to Vercel production and verify the retention run.
- [ ] Confirm Supabase backups and complete the first isolated restore drill.
- [ ] Complete Forge lint with the current CLI; do not use `--no-verify`.
- [ ] Resolve or formally accept every remaining production dependency advisory.
- [ ] Run the web regression suite, Forge contract tests, Jira sandbox install/upgrade/uninstall, and tenant-isolation test.
- [ ] Deploy Forge to `production` and confirm Marketplace licensing through the Forge License API.
- [ ] Test `active`, `inactive`, and `trial` license states in a non-production environment.
- [ ] Set the final AlignIQ custom domain in Vercel, Forge manifest egress, metadata, and listing URLs.
- [ ] Commission Marketplace icon, wordmark, three screenshots, and a short guided demo.
- [ ] Have counsel review the public privacy notice and terms.

## Submission evidence

- [ ] Listing copy and categories approved.
- [ ] Scope and egress justification approved.
- [ ] Support, privacy, terms, trust, and status URLs publicly reachable.
- [ ] Support contact and response targets staffed.
- [ ] Pricing and editions configured in the Atlassian vendor console.
- [ ] Data retention/deletion and incident-response runbooks assigned to named owners.
- [ ] Release notes, version number, and rollback decision documented.
