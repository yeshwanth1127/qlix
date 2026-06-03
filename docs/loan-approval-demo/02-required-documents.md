# NovaLend — Required Documents Checklist (Unsecured Personal Loan)

**Version:** 2026.1  
**Applies to:** Salaried applicants, India

## Mandatory (must be PRESENT before approval)

| Document | Freshness | Notes |
|----------|-----------|-------|
| Government photo ID | — | PAN + Aadhaar or passport |
| ITR | Latest completed FY | FY 2024-25 required when calendar year ≥ 2026 |
| Pay slips | Last 3 consecutive months | Name must match application |
| Bank statements | Last 6 months | All salary credits visible |
| Loan application form | Signed | Digital OK |

## Conditional

| Document | When required |
|----------|----------------|
| Employer verification letter | Salaried; must be dated within **90 days** |
| Form-16 only (no ITR) | **Insufficient** — status MISSING unless exception |
| Secondary income proof | If income includes freelance/rental |

## Staleness rules

| Item | STALE if |
|------|----------|
| Employer letter | Older than 90 days from application date |
| Pay slip | Older than 45 days |
| Bank statement | Most recent month > 45 days old |

## Quality flags (Document Gatherer)

Mark **HIGH** risk if any of:
- Missing latest ITR
- Employer letter STALE (> 90 days)
- Unexplained inbound transfer > ₹1,00,000 without memo in 6-month statements

Mark **MEDIUM** if:
- Only Form-16 provided without ITR
- Name minor mismatch correctable by affidavit

## Package completeness scoring

| Level | Criteria |
|-------|----------|
| LOW | All mandatory present, none STALE, no HIGH flags |
| MEDIUM | One conditional missing or one STALE item |
| HIGH | Missing ITR or HIGH flag present |

Approval requires **LOW** or **MEDIUM with documented mitigations**; **HIGH** requires additional documents before officer sign-off.
