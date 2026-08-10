/** Mirrors backend `googleServices.ts` for Connectors UI. */

export const GOOGLE_SERVICE_IDS = [
  "gmail",
  "drive",
  "calendar",
  "meet",
  "youtube",
] as const;

export type GoogleServiceId = (typeof GOOGLE_SERVICE_IDS)[number];

export interface GoogleServiceDef {
  readonly id: GoogleServiceId;
  readonly label: string;
  readonly description: string;
  /** OAuth scopes that mark this service connected. */
  readonly oauthScopes: readonly string[];
}

export const GOOGLE_SERVICES: readonly GoogleServiceDef[] = [
  {
    id: "gmail",
    label: "Gmail",
    description: "Read and send email",
    oauthScopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
  },
  {
    id: "drive",
    label: "Drive",
    description: "Read and write files",
    oauthScopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Read and write events",
    oauthScopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  },
  {
    id: "meet",
    label: "GMeet",
    description: "Create and manage Meet links",
    oauthScopes: ["https://www.googleapis.com/auth/meetings.space.created"],
  },
  {
    id: "youtube",
    label: "YouTube",
    description: "Read and publish videos",
    oauthScopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
    ],
  },
];

export function googleServiceConnected(
  serviceId: GoogleServiceId,
  grantedScopes: readonly string[],
): boolean {
  const granted = new Set(grantedScopes);
  if (serviceId === "gmail") {
    return (
      granted.has("https://www.googleapis.com/auth/gmail.readonly") &&
      granted.has("https://www.googleapis.com/auth/gmail.send")
    );
  }
  const svc = GOOGLE_SERVICES.find((s) => s.id === serviceId);
  if (!svc) return false;
  return svc.oauthScopes.every((s) => granted.has(s));
}

export function connectedGoogleServiceCount(grantedScopes: readonly string[]): number {
  return GOOGLE_SERVICES.filter((s) => googleServiceConnected(s.id, grantedScopes)).length;
}
