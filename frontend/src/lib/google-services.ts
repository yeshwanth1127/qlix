/** Mirrors backend `googleServices.ts` for Connectors UI. */

export const GOOGLE_SERVICE_IDS = [
  "gmail",
  "drive",
  "docs",
  "sheets",
  "slides",
  "forms",
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
    id: "docs",
    label: "Docs",
    description: "Read and write documents",
    oauthScopes: [
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/documents",
    ],
  },
  {
    id: "sheets",
    label: "Sheets",
    description: "Read and write spreadsheets",
    oauthScopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  },
  {
    id: "slides",
    label: "Slides",
    description: "Read and write presentations",
    oauthScopes: [
      "https://www.googleapis.com/auth/presentations.readonly",
      "https://www.googleapis.com/auth/presentations",
    ],
  },
  {
    id: "forms",
    label: "Forms",
    description: "Read and write forms and responses",
    oauthScopes: [
      "https://www.googleapis.com/auth/forms.body.readonly",
      "https://www.googleapis.com/auth/forms.body",
      "https://www.googleapis.com/auth/forms.responses.readonly",
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

/** Product-specific favicon domains for Connectors UI (falls back to Google logo). */
export const GOOGLE_SERVICE_LOGOS: Readonly<
  Partial<Record<GoogleServiceId, { slug: string; domain: string; color: string }>>
> = {
  gmail: { slug: "gmail", domain: "gmail.com", color: "EA4335" },
  drive: { slug: "googledrive", domain: "drive.google.com", color: "4285F4" },
  docs: { slug: "googledocs", domain: "docs.google.com", color: "4285F4" },
  sheets: { slug: "googlesheets", domain: "sheets.google.com", color: "0F9D58" },
  slides: { slug: "googleslides", domain: "slides.google.com", color: "F4B400" },
  forms: { slug: "googleforms", domain: "forms.google.com", color: "7248B9" },
  calendar: { slug: "googlecalendar", domain: "calendar.google.com", color: "4285F4" },
  meet: { slug: "googlemeet", domain: "meet.google.com", color: "00897B" },
};
