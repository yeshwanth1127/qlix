-- ============================================================================
-- PAY-PER-SUCCESS BILLING SYSTEM
-- Tables for tracking successful events and generating invoices
-- ============================================================================

-- Organizations (customers)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  stripe_customer_id VARCHAR(255) UNIQUE,
  current_plan VARCHAR(50) DEFAULT 'free', -- free, starter, pro, enterprise
  billing_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Users (team members in organizations)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'member', -- super_admin, org_admin, member
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- CORE BILLING TABLES
-- ============================================================================

-- Track every successful event (primary table)
CREATE TABLE successful_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL, -- passport_verify, trial_complete, log_entry, etc
  success_status VARCHAR(50) DEFAULT 'success', -- success, failed, refunded
  
  -- Pricing & billing
  amount_charged DECIMAL(10, 4) NOT NULL, -- How much to charge for this event ($0.10)
  billing_cycle VARCHAR(20) NOT NULL, -- Format: "2024-05" for May 2024
  invoice_id VARCHAR(255), -- Stripe invoice ID once billed
  
  -- Metadata
  event_data JSONB, -- Store request/response data if needed
  api_endpoint VARCHAR(255), -- Which API endpoint was called
  http_status_code INT, -- 200, 201, etc
  response_time_ms INT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  billed_at TIMESTAMP,
  refunded_at TIMESTAMP
);

-- Create indexes for fast queries
CREATE INDEX idx_successful_events_org_id ON successful_events(org_id);
CREATE INDEX idx_successful_events_billing_cycle ON successful_events(billing_cycle);
CREATE INDEX idx_successful_events_user_id ON successful_events(user_id);
CREATE INDEX idx_successful_events_created_at ON successful_events(created_at DESC);

-- Partition by month for performance (optional but recommended)
CREATE TABLE successful_events_2024_05 PARTITION OF successful_events
  FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');
CREATE TABLE successful_events_2024_06 PARTITION OF successful_events
  FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');
-- Add more partitions as needed

-- ============================================================================
-- FAILED EVENTS (for troubleshooting, no charges)
-- ============================================================================

CREATE TABLE failed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  error_message TEXT,
  error_code VARCHAR(50),
  
  -- Context
  api_endpoint VARCHAR(255),
  request_data JSONB,
  http_status_code INT,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_failed_events_org_id ON failed_events(org_id);
CREATE INDEX idx_failed_events_created_at ON failed_events(created_at DESC);

-- ============================================================================
-- PRICING & TIERS
-- ============================================================================

CREATE TABLE pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL, -- free, starter, pro, enterprise
  monthly_price DECIMAL(10, 2) NOT NULL,
  annual_price DECIMAL(10, 2),
  
  -- What's included
  included_successes INT, -- e.g., 1000 free successes per month
  
  -- Per-event overages (if any)
  overage_rate DECIMAL(10, 4), -- $0.05 per extra success
  
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default tiers
INSERT INTO pricing_tiers (name, monthly_price, included_successes, overage_rate, description) VALUES
('free', 0, 100, 0.00, 'Development/testing'),
('starter', 49, 500, 0.10, 'Small projects, up to 500 successful events/mo'),
('pro', 149, 5000, 0.05, 'Growing businesses, up to 5,000 events/mo'),
('enterprise', 999, 50000, 0.02, 'Large-scale operations');

-- ============================================================================
-- INVOICES
-- ============================================================================

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_invoice_id VARCHAR(255) UNIQUE,
  
  -- Amounts
  subtotal DECIMAL(10, 2) NOT NULL,
  tax DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL,
  
  -- Timeline
  billing_cycle VARCHAR(20) NOT NULL, -- "2024-05"
  due_date DATE,
  paid_at TIMESTAMP,
  
  status VARCHAR(50) DEFAULT 'draft', -- draft, pending, paid, failed, refunded
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_invoices_org_id ON invoices(org_id);
CREATE INDEX idx_invoices_billing_cycle ON invoices(billing_cycle);
CREATE INDEX idx_invoices_status ON invoices(status);

-- ============================================================================
-- LINE ITEMS (breakdown of what was charged)
-- ============================================================================

CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  
  description VARCHAR(255), -- "Passport verifications", "Trial completions", etc
  event_type VARCHAR(100),
  quantity INT, -- Number of successful events
  unit_price DECIMAL(10, 4), -- $0.10 per event
  amount DECIMAL(10, 2), -- quantity * unit_price
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- REFUNDS
-- ============================================================================

CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  event_id UUID REFERENCES successful_events(id),
  
  amount DECIMAL(10, 2) NOT NULL,
  reason VARCHAR(255), -- "bug_in_service", "duplicate_charge", "customer_request"
  status VARCHAR(50) DEFAULT 'pending', -- pending, processed, failed
  
  stripe_refund_id VARCHAR(255),
  
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);

-- ============================================================================
-- USAGE METRICS (for dashboard, denormalized for fast reads)
-- ============================================================================

CREATE TABLE usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL, -- rolled up daily
  
  event_type VARCHAR(100),
  successful_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  revenue_generated DECIMAL(10, 2) DEFAULT 0,
  
  UNIQUE(org_id, metric_date, event_type)
);

CREATE INDEX idx_usage_metrics_org_id ON usage_metrics(org_id);
CREATE INDEX idx_usage_metrics_metric_date ON usage_metrics(metric_date DESC);

-- ============================================================================
-- BILLING LOGS (for debugging & audit trail)
-- ============================================================================

CREATE TABLE billing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  action VARCHAR(100), -- 'invoice_created', 'payment_charged', 'refund_issued', etc
  details JSONB,
  
  status VARCHAR(50), -- 'success', 'failed'
  error_message TEXT,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_billing_logs_org_id ON billing_logs(org_id);
CREATE INDEX idx_billing_logs_created_at ON billing_logs(created_at DESC);

-- ============================================================================
-- API KEYS (for authentication)
-- ============================================================================

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  
  key_hash VARCHAR(255) NOT NULL, -- Hash of actual key (never store plain)
  name VARCHAR(255), -- "Production API Key", "Testing Key"
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_api_keys_org_id ON api_keys(org_id);
