# NovaLend Personal Loan — Underwriting Standards (Demo Policy v2026.1)

**Product:** Unsecured personal loans  
**Effective:** 2026-01-01  
**Owner:** Credit Risk

## Eligibility

| Rule | Requirement |
|------|-------------|
| Minimum age | 21 years |
| Maximum age at maturity | 65 years |
| Minimum credit score | 680 (bureau score, most recent pull) |
| Citizenship / residency | India resident; valid KYC |

## Debt-to-income (DTI)

**Maximum post-loan DTI: 43%**

```
DTI % = (total monthly debt obligations + proposed new loan EMI) / gross monthly income × 100
```

- **Gross monthly income** = verified salary ÷ 12. Do not include unverified income in PASS/FAIL unless policy exception below applies.
- **Total monthly debt obligations** includes: all EMIs, credit card minimum payments (use statement minimum if revolving), other reported obligations.
- **Proposed new loan EMI** must be included in the numerator for approval decisions.

### Unverified secondary income

Freelance, rental, or other non-payroll income may be listed as **informational only** until verified with:
- 12 months bank credits + invoices, or
- ITR schedules showing the income line.

For automated scoring:
- **PASS/FAIL** must use **salary-only** DTI unless Secondary Income Verification (SIV) is complete.
- If salary-only DTI ≤ 43% and verified total (salary + SIV) ≤ 43%, status may be **CONDITIONAL_PASS** pending SIV.

## Credit score bands

| Score | Decision guidance |
|-------|-------------------|
| 720+ | Standard pricing tier |
| 680–719 | Eligible if DTI and docs pass; may require senior review if DTI > 38% |
| Below 680 | **Decline** unless manual exception with Credit Committee approval |

## Loan amount limits (unsecured)

| Verified annual income | Max loan amount |
|------------------------|-----------------|
| < ₹6,00,000 | ₹3,00,000 |
| ₹6,00,000 – ₹12,00,000 | ₹8,50,000 |
| > ₹12,00,000 | ₹15,00,000 |

Applicant in demo band ₹12,00,000 → max **₹8,50,000** unsecured.

## Conditions that trigger senior review (not auto-decline)

- DTI 40%–43% inclusive
- Credit score 680–699
- Any single bank credit > ₹1,00,000 unexplained in last 6 months
