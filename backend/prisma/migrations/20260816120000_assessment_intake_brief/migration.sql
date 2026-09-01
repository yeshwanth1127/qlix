-- Staff-authored assessment brief, captured at session creation: what the
-- student is meant to build, the expected stack, a time window, an optional
-- AI-usage policy, and the checklist/deliverables an evaluator will judge
-- against later.

ALTER TABLE "work_sessions" ADD COLUMN     "ai_usage_policy" TEXT,
ADD COLUMN     "checklist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "expected_stack" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "project_description" TEXT,
ADD COLUMN     "required_deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "window_ends_at" TIMESTAMP(3),
ADD COLUMN     "window_starts_at" TIMESTAMP(3);
