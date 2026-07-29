# IT Support & Access Rules

*Fictional test content for Nimbus Retail Co. Owner: Engineering & Data (IT function).*

## Support channels & SLAs

| Channel | Use for | Response SLA |
|---|---|---|
| `#it-urgent` (Slack) | Outages, security incidents, lost/stolen device | 15 minutes, business hours; 1 hour off-hours |
| `NIMOPS` Jira project, type "IT Request" | New equipment, software installs, access requests | 1 business day acknowledgment, 3 business days resolution |
| `NIMOPS`, type "Access Request" | Granting/revoking system access | 2 business days, requires manager approval attached |
| it-help@nimbus-retail.example | General questions | 1 business day |

## New hire provisioning SLA

- Accounts (Google Workspace, Slack, Jira) created **3 business days before start date**.
- Laptop shipped to arrive **1 business day before start date** for remote hires; pre-staged at desk for HQ hires.
- Role-based system access (e.g., Zendesk, AWS, Shopify admin) requested by the hiring manager no later than the offer-acceptance date, so it's ready by day 1 — late requests may delay a new hire's ability to start real work.

## Standard access tiers

- **Tier 0 (all employees):** Email, Slack, Jira, company wiki, Rippling.
- **Tier 1 (role-based):** Zendesk (Support), Shopify admin (Retail Ops/Marketing), Ramp (all, but limits vary), ShipHero (Warehouse).
- **Tier 2 (elevated, ticket + manager approval required):** AWS production read access, database read replicas, customer PII exports.
- **Tier 3 (restricted, 2-approver rule):** AWS production write/admin access, payments system configuration, the AI Brain org-admin role (can create/delete knowledge collections and view audit logs).

## Access reviews

- Quarterly access review: each manager re-certifies their team's Tier 2/Tier 3 access in the `NIMOPS` "Access Review" ticket. Unconfirmed access is auto-revoked after 10 business days.
- Any employee who changes teams has their old team's access reviewed and typically revoked within 5 business days of the transfer, unless the new manager explicitly requests it stay.

## Offboarding checklist (IT)

Triggered automatically when People Ops marks an employee as terminated in Rippling:

1. All SSO sessions revoked within **1 hour** of the offboarding meeting.
2. Laptop return: shipping label emailed same day; equipment must be returned within 10 business days or the employee is billed for replacement cost.
3. Slack/email access downgraded to "view archive only" for 30 days (for handoff purposes), then fully deactivated.
4. Any AI Brain knowledge collections or agents the employee owned are reassigned to their manager or a designated team lead — ownership should never be left pointing at a deactivated account.

## Software requests

- Standard bundle (browser, Slack, Zoom, 1Password, standard IDE) is pre-installed, no ticket needed.
- Anything else — including browser extensions requesting broad site permissions — requires an IT Request ticket and, if it touches Internal data or above, a Vendor Security Review per the Data Security Policy.
- Local admin rights on company laptops are granted only to Engineering roles by default; other roles can request temporary admin via ticket, auto-expiring after 24 hours.
