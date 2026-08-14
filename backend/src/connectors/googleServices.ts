/**
 * Google Workspace products exposed as individually connectable services
 * under the single `google` connector account.
 *
 * Connection state is derived from OAuth scopes stored on ConnectorAccount.
 */

export const GOOGLE_SERVICE_IDS = [
  'gmail',
  'drive',
  'docs',
  'sheets',
  'slides',
  'forms',
  'calendar',
  'meet',
  'youtube',
] as const;

export type GoogleServiceId = (typeof GOOGLE_SERVICE_IDS)[number];

export interface GoogleServiceDef {
  id: GoogleServiceId;
  label: string;
  description: string;
  /** OAuth scopes requested when the user connects this service. */
  oauthScopes: readonly string[];
  /** Agent permission scopes unlocked by this service. */
  permissionScopes: readonly string[];
}

/** Always requested with every Google service connect (identity). */
export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;

export const GOOGLE_SERVICES: Record<GoogleServiceId, GoogleServiceDef> = {
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    description: 'Read and send email',
    oauthScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
    ],
    permissionScopes: ['email.read', 'email.send'],
  },
  drive: {
    id: 'drive',
    label: 'Drive',
    description: 'Read and write files',
    oauthScopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    permissionScopes: ['drive.read', 'drive.write'],
  },
  docs: {
    id: 'docs',
    label: 'Docs',
    description: 'Read and write documents',
    oauthScopes: [
      'https://www.googleapis.com/auth/documents.readonly',
      'https://www.googleapis.com/auth/documents',
    ],
    permissionScopes: ['docs.read', 'docs.write'],
  },
  sheets: {
    id: 'sheets',
    label: 'Sheets',
    description: 'Read and write spreadsheets',
    oauthScopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
    permissionScopes: ['sheets.read', 'sheets.write'],
  },
  slides: {
    id: 'slides',
    label: 'Slides',
    description: 'Read and write presentations',
    oauthScopes: [
      'https://www.googleapis.com/auth/presentations.readonly',
      'https://www.googleapis.com/auth/presentations',
    ],
    permissionScopes: ['slides.read', 'slides.write'],
  },
  forms: {
    id: 'forms',
    label: 'Forms',
    description: 'Read and write forms and responses',
    oauthScopes: [
      'https://www.googleapis.com/auth/forms.body.readonly',
      'https://www.googleapis.com/auth/forms.body',
      'https://www.googleapis.com/auth/forms.responses.readonly',
    ],
    permissionScopes: ['forms.read', 'forms.write'],
  },
  calendar: {
    id: 'calendar',
    label: 'Calendar',
    description: 'Read and write events',
    oauthScopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    permissionScopes: ['calendar.read', 'calendar.write'],
  },
  meet: {
    id: 'meet',
    label: 'GMeet',
    description: 'Create and manage Meet links',
    oauthScopes: ['https://www.googleapis.com/auth/meetings.space.created'],
    permissionScopes: ['meet.manage'],
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    description: 'Read and publish videos',
    oauthScopes: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.upload',
    ],
    permissionScopes: ['youtube.read', 'youtube.publish'],
  },
};

export const GOOGLE_SERVICES_LIST: readonly GoogleServiceDef[] = GOOGLE_SERVICE_IDS.map(
  (id) => GOOGLE_SERVICES[id],
);

/** Permission scope → Google service that must be connected. */
export const PERMISSION_SCOPE_GOOGLE_SERVICE: Readonly<Partial<Record<string, GoogleServiceId>>> =
  Object.fromEntries(
    GOOGLE_SERVICES_LIST.flatMap((svc) => svc.permissionScopes.map((scope) => [scope, svc.id])),
  );

export function isGoogleServiceId(value: unknown): value is GoogleServiceId {
  return typeof value === 'string' && (GOOGLE_SERVICE_IDS as readonly string[]).includes(value);
}

/** True when granted OAuth scopes cover this service. */
export function googleServiceConnected(
  serviceId: GoogleServiceId,
  grantedScopes: readonly string[],
): boolean {
  const granted = new Set(grantedScopes);
  const svc = GOOGLE_SERVICES[serviceId];

  // Legacy Gmail connectors may lack gmail.compose — still count as connected.
  if (serviceId === 'gmail') {
    return (
      granted.has('https://www.googleapis.com/auth/gmail.readonly') &&
      granted.has('https://www.googleapis.com/auth/gmail.send')
    );
  }

  return svc.oauthScopes.every((s) => granted.has(s));
}

/** OAuth scopes to request for a service connect (identity + service). */
export function oauthScopesForGoogleService(serviceId: GoogleServiceId): string[] {
  return [...GOOGLE_IDENTITY_SCOPES, ...GOOGLE_SERVICES[serviceId].oauthScopes];
}

/** Strip a service's OAuth scopes from a granted list (keeps identity + other services). */
export function removeGoogleServiceScopes(
  serviceId: GoogleServiceId,
  grantedScopes: readonly string[],
): string[] {
  const drop = new Set<string>(GOOGLE_SERVICES[serviceId].oauthScopes);
  return grantedScopes.filter((s) => !drop.has(s));
}

/** True when any Google product service (not just identity) is still linked. */
export function anyGoogleServiceConnected(grantedScopes: readonly string[]): boolean {
  return GOOGLE_SERVICE_IDS.some((id) => googleServiceConnected(id, grantedScopes));
}
