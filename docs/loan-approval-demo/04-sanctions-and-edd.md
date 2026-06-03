# NovaLend — Sanctions Screening & Enhanced Due Diligence (EDD)

**Version:** 2026.1

## Sanctions screening

- All applicants screened against internal watchlist + partner API (stated result: CLEAR / HIT).
- **HIT** → automatic **BLOCKER: DECLINE**; no officer override without AML Committee.
- **CLEAR** required before APPROVE or CONDITIONAL_APPROVE.

## Politically exposed persons (PEP)

- If PEP flag → CONDITIONAL only; EDD package mandatory.

## Enhanced due diligence triggers

EDD is required when **any** of:

| Trigger | Action |
|---------|--------|
| Sanctions ambiguous / pending | Hold decision |
| Single unexplained credit > ₹1,00,000 in 6mo statements | Source-of-funds letter + 2nd bank proof |
| Missing latest ITR | Upload ITR or tax computation |
| Stale employer verification (> 90 days) | New employer letter on letterhead |
| DTI > 40% using verified income only | Senior credit review |

## Source of funds — large gifts

Inbound transfers labeled "gift", "family", or similar above **₹1,00,000**:
1. Donor declaration signed
2. Donor KYC snapshot (if donor is individual)
3. Entry in EDD log

Until complete: maximum decision **CONDITIONAL_APPROVE**, not final APPROVE.

## Record keeping

EDD steps must appear in officer brief for audit trail (6-year retention).
