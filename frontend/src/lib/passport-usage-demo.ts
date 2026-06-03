/**
 * Demo passport service usage (X-Exora-Identity flow). Replace with API when wired.
 * Shape matches the intended usage log payload.
 */

export interface PassportUsageTimelineRow {
  readonly timestamp: string;
  readonly website: string;
  readonly action: string;
  readonly result: "success" | "failed";
  readonly captchaBypassed: boolean;
}

export interface PassportUsageDemoBundle {
  readonly totalUsages: number;
  readonly successRatePct: string;
  readonly lastUsedLabel: string;
  readonly topWebsite: string;
  readonly topWebsiteUses: number;
  readonly captchasBypassed: number;
  readonly timeline: readonly PassportUsageTimelineRow[];
}

const TIMELINE_A: readonly PassportUsageTimelineRow[] = [
  {
    timestamp: "2026-05-03 14:22:01 UTC",
    website: "stripe.com",
    action: "POST /checkout",
    result: "success",
    captchaBypassed: true,
  },
  {
    timestamp: "2026-05-03 13:08:44 UTC",
    website: "stripe.com",
    action: "GET /pay",
    result: "success",
    captchaBypassed: true,
  },
  {
    timestamp: "2026-05-03 11:55:12 UTC",
    website: "github.com",
    action: "POST /login/oauth",
    result: "success",
    captchaBypassed: false,
  },
  {
    timestamp: "2026-05-02 22:41:09 UTC",
    website: "stripe.com",
    action: "POST /checkout",
    result: "success",
    captchaBypassed: true,
  },
  {
    timestamp: "2026-05-02 18:03:51 UTC",
    website: "notion.so",
    action: "GET /api/v1/pages",
    result: "success",
    captchaBypassed: true,
  },
  {
    timestamp: "2026-05-02 09:17:33 UTC",
    website: "linear.app",
    action: "POST /graphql",
    result: "failed",
    captchaBypassed: false,
  },
  {
    timestamp: "2026-05-01 16:44:02 UTC",
    website: "stripe.com",
    action: "POST /checkout",
    result: "success",
    captchaBypassed: true,
  },
  {
    timestamp: "2026-05-01 08:12:00 UTC",
    website: "vercel.com",
    action: "POST /deploy",
    result: "success",
    captchaBypassed: false,
  },
  {
    timestamp: "2026-04-30 21:29:18 UTC",
    website: "shopify.com",
    action: "POST /admin/api/orders",
    result: "success",
    captchaBypassed: true,
  },
  {
    timestamp: "2026-04-30 07:05:55 UTC",
    website: "stripe.com",
    action: "GET /customers",
    result: "success",
    captchaBypassed: true,
  },
];

const VARIANTS: readonly PassportUsageDemoBundle[] = [
  {
    totalUsages: 47,
    successRatePct: "96.3",
    lastUsedLabel: "2 min ago",
    topWebsite: "stripe.com",
    topWebsiteUses: 24,
    captchasBypassed: 34,
    timeline: TIMELINE_A,
  },
  {
    totalUsages: 18,
    successRatePct: "100",
    lastUsedLabel: "18 min ago",
    topWebsite: "github.com",
    topWebsiteUses: 9,
    captchasBypassed: 11,
    timeline: [
      { timestamp: "2026-05-03 12:00:00 UTC", website: "github.com", action: "POST /repos/hooks", result: "success", captchaBypassed: true },
      { timestamp: "2026-05-03 09:15:22 UTC", website: "gitlab.com", action: "GET /api/v4/projects", result: "success", captchaBypassed: false },
      { timestamp: "2026-05-02 20:01:11 UTC", website: "github.com", action: "POST /graphql", result: "success", captchaBypassed: true },
      { timestamp: "2026-05-02 14:44:44 UTC", website: "github.com", action: "GET /user", result: "success", captchaBypassed: true },
      { timestamp: "2026-05-01 19:30:00 UTC", website: "npmjs.com", action: "GET /package/express", result: "success", captchaBypassed: false },
      { timestamp: "2026-05-01 08:00:01 UTC", website: "github.com", action: "POST /repos/clone", result: "success", captchaBypassed: true },
      { timestamp: "2026-04-30 22:22:22 UTC", website: "github.com", action: "GET /notifications", result: "success", captchaBypassed: true },
      { timestamp: "2026-04-30 11:11:11 UTC", website: "sentry.io", action: "POST /api/store", result: "success", captchaBypassed: false },
      { timestamp: "2026-04-29 16:16:16 UTC", website: "github.com", action: "GET /rate_limit", result: "success", captchaBypassed: true },
      { timestamp: "2026-04-29 09:09:09 UTC", website: "github.com", action: "POST /markdown", result: "success", captchaBypassed: true },
    ],
  },
  {
    totalUsages: 6,
    successRatePct: "83.3",
    lastUsedLabel: "3 h ago",
    topWebsite: "linear.app",
    topWebsiteUses: 3,
    captchasBypassed: 2,
    timeline: [
      { timestamp: "2026-05-03 10:00:00 UTC", website: "linear.app", action: "POST /graphql", result: "success", captchaBypassed: false },
      { timestamp: "2026-05-02 15:30:00 UTC", website: "linear.app", action: "POST /graphql", result: "failed", captchaBypassed: false },
      { timestamp: "2026-05-01 12:00:00 UTC", website: "figma.com", action: "GET /files", result: "success", captchaBypassed: true },
      { timestamp: "2026-04-30 09:00:00 UTC", website: "linear.app", action: "GET /issues", result: "success", captchaBypassed: false },
      { timestamp: "2026-04-29 18:00:00 UTC", website: "slack.com", action: "POST /api/chat.postMessage", result: "success", captchaBypassed: true },
      { timestamp: "2026-04-28 11:00:00 UTC", website: "linear.app", action: "POST /graphql", result: "success", captchaBypassed: false },
      { timestamp: "2026-04-27 14:00:00 UTC", website: "notion.so", action: "GET /v1/pages", result: "success", captchaBypassed: false },
      { timestamp: "2026-04-26 08:00:00 UTC", website: "linear.app", action: "POST /graphql", result: "success", captchaBypassed: false },
      { timestamp: "2026-04-25 17:00:00 UTC", website: "linear.app", action: "GET /cycles", result: "success", captchaBypassed: false },
      { timestamp: "2026-04-24 10:00:00 UTC", website: "linear.app", action: "POST /graphql", result: "success", captchaBypassed: false },
    ],
  },
];

export function getPassportUsageDemo(agentId: string): PassportUsageDemoBundle {
  let n = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    n = (n + agentId.charCodeAt(i)) % 997;
  }
  return VARIANTS[n % VARIANTS.length]!;
}
