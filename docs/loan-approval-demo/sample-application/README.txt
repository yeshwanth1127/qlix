NovaLend — Sample Loan Application LA-2026-0847
=================================================

This folder is a FAKE loan application used for the Qlix end-to-end test
("hybrid + brain + WhatsApp" loan underwriting demo).

Applicant:        Priya Sharma
Application ID:   LA-2026-0847
Product:          Unsecured personal loan
Requested amount: INR 6,00,000
Tenure:           36 months

WHAT'S IN THIS FOLDER
---------------------
application_form.txt          - Signed application form (demo)
bank_statement.txt            - 3-month salary account statement
salary_slip_MAR2026.txt       - Latest salary slip
salary_slip_FEB2026.txt       - Previous month salary slip
form16_FY24.txt               - Form-16 for FY24-25 (instead of full ITR)
employer_letter_DEC2025.txt   - Employer verification letter (STALE — 5 months old)

WHAT'S INTENTIONALLY MISSING
----------------------------
- Latest ITR (FY24-25)              -> compliance MUST flag this
- CIBIL credit report               -> compliance MUST flag this
- Fresh employer letter (<3 months) -> compliance MUST flag the stale letter

WHAT THE AGENTS SHOULD FIND
---------------------------
1. Document Gatherer: list 6 files, flag missing ITR + stale employer letter,
   and flag the INR 2,40,000 unexplained inbound transfer on 12-Mar-2026.
2. DTI Calculator: DTI roughly 42% salary-only, ~37% if freelance income
   is allowed — borderline against the 40% policy cap.
3. Compliance Checker: CONDITIONAL — EDD required (large unexplained credit)
   and missing ITR; cite Loan Policies in the AI Brain.
4. Ops Supervisor: CONDITIONAL_APPROVE with 3 numbered conditions.

This is DEMO DATA ONLY. Not a real loan, not a real person.
