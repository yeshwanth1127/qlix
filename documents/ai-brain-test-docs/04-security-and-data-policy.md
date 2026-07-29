# Data Security & Acceptable Use Policy

*Fictional test content for Nimbus Retail Co. Owner: Engineering & Data (Alex Chen's team), reviewed by People Ops.*

## Data classification

| Level | Examples | Handling rule |
|---|---|---|
| **Public** | Marketing pages, published prices | No restriction |
| **Internal** | Org charts, roadmaps, internal wikis | Nimbus employees + contractors under NDA only |
| **Confidential** | Customer PII, order history, vendor contracts | Named access list; no export to personal devices |
| **Restricted** | Payment card data, SSNs, background check results | Encrypted at rest, access logged, 2 approvers required to grant access |

Payment card data is never stored directly by Nimbus — all card handling is delegated to Stripe (PCI DSS compliance boundary). Any system that touches Restricted data must be listed in the Data Inventory maintained by Engineering.

## Password & authentication rules

- Minimum 12 characters, no forced periodic rotation (rotation only required after a suspected compromise).
- MFA is mandatory for: Google Workspace, AWS, Rippling, Ramp, and the internal admin dashboard.
- Shared/service account credentials must be stored in the team's 1Password vault — never in Slack, email, or plaintext config files committed to git.
- SSO session timeout: 12 hours idle for standard apps, 1 hour idle for AWS production console access.

## Device rules

- Company laptops must have full-disk encryption and the endpoint agent (Jamf for macOS, Intune for Windows) installed before any internal system access.
- Personal devices may access email and Slack (mobile) but may **not** access Confidential or Restricted systems.
- Lost or stolen device: notify IT within 1 hour via the `#it-urgent` Slack channel or the NIMOPS emergency ticket type. IT will remote-wipe within 4 hours of notification.

## Incident reporting

1. Anyone who suspects a security incident (phishing click, lost device, unauthorized access, suspicious email) must report it immediately to `security@nimbus-retail.example` or `#it-urgent`. Do not wait to "confirm" it first.
2. Engineering on-call triages within **30 minutes** during business hours, **2 hours** off-hours.
3. Incidents involving Confidential or Restricted data trigger the Incident Response runbook and a mandatory notification to the CEO and Legal within 24 hours.
4. Customer-notification decisions (if any customer data was exposed) are made jointly by Legal and the CEO — engineers do not communicate with customers directly about a breach.

## Third-party tools & vendor approval

- Any new SaaS tool that will touch Internal data or above must go through Vendor Security Review (submit via `NIMOPS` project, ticket type "Vendor Review"). Turnaround target: 5 business days.
- Browser extensions that request broad permissions ("read and change all your data on websites") are blocked by default on managed devices; exceptions require IT approval.

## Data retention

- Customer support tickets: retained 3 years, then anonymized.
- Order/transaction records: retained 7 years for tax/accounting purposes.
- Employee records: retained per state requirements, minimum 4 years post-termination.
- AI Brain knowledge collections (this system): default retention is set per-collection by an org admin; if unset, documents are retained indefinitely until manually deleted.
