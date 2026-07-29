-- Backfill: existing balance treated as paid credit (never-expiring), currency corrected to INR.
UPDATE wallets
SET
  paid_balance = balance,
  currency = 'INR';