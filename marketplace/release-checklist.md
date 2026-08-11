# Marketplace release checklist

## Blocking before production promotion

- [x] Apply web database migrations 009 and 010 in Supabase production.
- [x] Add `CRON_SECRET` to Vercel production.
- [x] Verify a successful production retention execution (`2026-08-11T18:28:24.02496Z`); confirm `/api/health` reports it current after deployment.
- [ ] Confirm Supabase backups and complete the first isolated restore drill.
- [x] Complete Forge lint with the current CLI; do not use `--no-verify`.
- [x] Resolve or formally accept every remaining production dependency advisory.
- [x] Run automated web regression and Forge contract tests on the candidate commits.
- [ ] Complete Jira sandbox install/upgrade/uninstall and the manual tenant-isolation matrix.
- [ ] Deploy Forge to `production` and confirm Marketplace licensing through the Forge License API.
- [ ] Test `active`, `inactive`, and `trial` license states in a non-production environment.
- [ ] Set the final AlignIQ custom domain in Vercel, Forge manifest egress, metadata, and listing URLs.
- [ ] Commission Marketplace icon, wordmark, three screenshots, and a short guided demo.
- [ ] Have counsel review the public privacy notice and terms.

## Submission evidence

- [ ] Listing copy and categories approved.
- [ ] Scope and egress justification approved.
- [x] Support, privacy, terms, trust, and status URLs publicly reachable.
- [ ] Support contact and response targets staffed.
- [ ] Pricing and editions configured in the Atlassian vendor console.
- [ ] Data retention/deletion and incident-response runbooks assigned to named owners.
- [x] Release candidate, known issues, and rollback decision documented in the web repository UAT release record.
