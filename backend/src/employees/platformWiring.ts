import type { ConnectorProvider } from '../connectors/connectors.types.js';
import type { PermissionScope } from '../agents/agents.types.js';

/** Maps catalog platform ids (see frontend connector-catalog) to live Qlix wiring. */
export interface PlatformWiring {
  providers: ConnectorProvider[];
  scopes: PermissionScope[];
  /** Scopes that require JIT when this platform is selected. */
  jitScopes: PermissionScope[];
}

const SOCIAL_SCOPES: PermissionScope[] = ['social.read', 'social.publish'];
const EMAIL_SCOPES: PermissionScope[] = ['email.read', 'email.send'];
const GOOGLE_SCOPES: PermissionScope[] = [
  ...EMAIL_SCOPES,
  'drive.read',
  'drive.write',
  'docs.read',
  'docs.write',
  'sheets.read',
  'sheets.write',
  'slides.read',
  'slides.write',
  'forms.read',
  'forms.write',
  'calendar.read',
  'calendar.write',
  'meet.manage',
  'youtube.read',
  'youtube.publish',
];
const CRM_SCOPES: PermissionScope[] = ['crm.read', 'crm.write', 'crm.delete'];

export const PLATFORM_WIRING: Record<string, PlatformWiring> = {
  google: {
    providers: ['google'],
    scopes: GOOGLE_SCOPES,
    jitScopes: [
      'email.send',
      'drive.write',
      'docs.write',
      'sheets.write',
      'slides.write',
      'forms.write',
      'calendar.write',
      'meet.manage',
      'youtube.publish',
    ],
  },
  zoho: {
    providers: ['zoho'],
    scopes: CRM_SCOPES,
    jitScopes: ['crm.write', 'crm.delete'],
  },
  whatsapp: {
    providers: ['whatsapp_baileys'],
    scopes: ['whatsapp.send', 'whatsapp.read', 'whatsapp.contact_send', 'whatsapp.auto_reply'],
    jitScopes: [],
  },
  facebook: { providers: ['orbit'], scopes: SOCIAL_SCOPES, jitScopes: ['social.publish'] },
  instagram: { providers: ['orbit'], scopes: SOCIAL_SCOPES, jitScopes: ['social.publish'] },
  x: { providers: ['orbit'], scopes: SOCIAL_SCOPES, jitScopes: ['social.publish'] },
  linkedin: { providers: ['orbit'], scopes: SOCIAL_SCOPES, jitScopes: ['social.publish'] },
  youtube: { providers: ['orbit'], scopes: SOCIAL_SCOPES, jitScopes: ['social.publish'] },
  tiktok: { providers: ['orbit'], scopes: SOCIAL_SCOPES, jitScopes: ['social.publish'] },
};

export function resolveSelectedPlatforms(platformIds: readonly string[]): {
  providers: ConnectorProvider[];
  scopes: PermissionScope[];
  jitScopes: PermissionScope[];
  soonPlatformIds: string[];
} {
  const providers = new Set<ConnectorProvider>();
  const scopes = new Set<PermissionScope>();
  const jitScopes = new Set<PermissionScope>();
  const soonPlatformIds: string[] = [];

  for (const id of platformIds) {
    const wiring = PLATFORM_WIRING[id];
    if (!wiring) {
      soonPlatformIds.push(id);
      continue;
    }
    for (const p of wiring.providers) providers.add(p);
    for (const s of wiring.scopes) scopes.add(s);
    for (const j of wiring.jitScopes) jitScopes.add(j);
  }

  return {
    providers: [...providers],
    scopes: [...scopes],
    jitScopes: [...jitScopes],
    soonPlatformIds,
  };
}

/** Qlix provider ids for Connectors page `?needed=` param. */
export function providersForConnectorsPage(providers: readonly ConnectorProvider[]): string {
  return [...new Set(providers)].join(',');
}
