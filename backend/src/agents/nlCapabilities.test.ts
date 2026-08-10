import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FORCE_JIT_SCOPES } from './jit.js';
import {
  buildAgentToolSchema,
  buildTeamToolSchema,
  buildSystemPrompt,
} from './nlCapabilities.js';
import { selectNlPromptPacks } from './nlPromptPacks.js';
import { ALL_PERMISSION_SCOPES } from './agents.types.js';
import { SCOPE_CATALOG, SCOPE_CATALOG_BY_ID, getEffectiveScopes } from './scopeCatalog.js';

describe('scopeCatalog', () => {
  it('whatsapp.send is a connector-gated, non-JIT scope', () => {
    const s = SCOPE_CATALOG_BY_ID['whatsapp.send'];
    assert.ok(s, 'whatsapp.send missing from catalog');
    assert.equal(s.forceJit, false);
    assert.equal(s.requiresConnector, 'whatsapp_baileys');
  });

  it('email scopes require the google connector', () => {
    assert.equal(SCOPE_CATALOG_BY_ID['email.send'].requiresConnector, 'google');
    assert.equal(SCOPE_CATALOG_BY_ID['email.read'].requiresConnector, 'google');
  });

  it('ALL_PERMISSION_SCOPES and FORCE_JIT_SCOPES are derived from the catalog', () => {
    assert.deepEqual(ALL_PERMISSION_SCOPES, SCOPE_CATALOG.map((s) => s.id));
    assert.deepEqual(FORCE_JIT_SCOPES, SCOPE_CATALOG.filter((s) => s.forceJit).map((s) => s.id));
  });
});

describe('getEffectiveScopes (no org / no connectors)', () => {
  it('marks base scopes available and connector scopes unavailable', async () => {
    const scopes = await getEffectiveScopes(null);
    const byId = Object.fromEntries(scopes.map((s) => [s.id, s]));
    assert.equal(byId['web.read'].available, true);
    assert.equal(byId['email.send'].available, false);
    assert.equal(byId['email.send'].connected, false);
    assert.equal(byId['whatsapp.send'].available, false);
  });
});

describe('jit.ts', () => {
  it('includes email.send in FORCE_JIT_SCOPES', () => {
    assert.ok(FORCE_JIT_SCOPES.includes('email.send'));
  });

  it('does not force JIT on whatsapp.send', () => {
    assert.ok(!FORCE_JIT_SCOPES.includes('whatsapp.send'));
  });
});

describe('buildAgentToolSchema', () => {
  it('returns plan_single_agent function tool', () => {
    const tool = buildAgentToolSchema(SCOPE_CATALOG) as any;
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.name, 'plan_single_agent');
  });

  it('permissionScopes items are plain strings without large enums', () => {
    const tool = buildAgentToolSchema(SCOPE_CATALOG) as any;
    const items = tool.function.parameters.properties.agent.properties.permissionScopes.items;
    assert.equal(items.type, 'string');
    assert.equal(items.enum, undefined);
  });

  it('runtime enum has all three values', () => {
    const tool = buildAgentToolSchema(SCOPE_CATALOG) as any;
    const runtimeEnum = tool.function.parameters.properties.agent.properties.runtime.enum;
    assert.deepEqual(runtimeEnum, ['cloud', 'hybrid', 'local']);
  });

  it('required fields include all agent properties', () => {
    const tool = buildAgentToolSchema(SCOPE_CATALOG) as any;
    const required: string[] = tool.function.parameters.properties.agent.required;
    for (const field of [
      'name',
      'description',
      'permissionScopes',
      'jitScopes',
      'runtime',
      'model',
      'llmMode',
      'localInferenceMode',
    ]) {
      assert.ok(required.includes(field), `missing required field: ${field}`);
    }
  });
});

describe('buildTeamToolSchema', () => {
  it('returns plan_team function tool', () => {
    const tool = buildTeamToolSchema(SCOPE_CATALOG) as any;
    assert.equal(tool.function.name, 'plan_team');
  });

  it('workers items include role and stageOrder', () => {
    const tool = buildTeamToolSchema(SCOPE_CATALOG) as any;
    const workerRequired: string[] =
      tool.function.parameters.properties.team.properties.workers.items.required;
    assert.ok(workerRequired.includes('role'));
    assert.ok(workerRequired.includes('stageOrder'));
  });

  it('config has all three retry policies', () => {
    const tool = buildTeamToolSchema(SCOPE_CATALOG) as any;
    const retryEnum =
      tool.function.parameters.properties.team.properties.config.properties.retryPolicy.enum;
    assert.deepEqual(retryEnum, ['none', 'once', 'twice']);
  });
});

describe('selectNlPromptPacks', () => {
  it('returns empty packs for a generic prompt', () => {
    assert.deepEqual(selectNlPromptPacks('Build a helpful research assistant'), []);
  });

  it('selects local pack for file control', () => {
    assert.deepEqual(selectNlPromptPacks('create a hybrid agent for local file control'), [
      'local',
    ]);
  });

  it('selects leads pack for Google Maps', () => {
    assert.ok(selectNlPromptPacks('scrape google maps for leads').includes('leads'));
  });

  it('selects jobs pack for ATS apply', () => {
    assert.ok(selectNlPromptPacks('apply to jobs on Greenhouse with my resume').includes('jobs'));
  });

  it('selects crm pack for Zoho', () => {
    assert.ok(selectNlPromptPacks('agent to manage my zoho crm').includes('crm'));
  });
});

describe('buildSystemPrompt', () => {
  it('contains all passed FORCE_JIT_SCOPES', () => {
    const prompt = buildSystemPrompt(SCOPE_CATALOG);
    for (const scope of FORCE_JIT_SCOPES) {
      assert.ok(prompt.includes(scope), `prompt missing JIT scope: ${scope}`);
    }
  });

  it('lists exactly the scopes it is given', () => {
    const narrowed = SCOPE_CATALOG.filter((s) => !s.requiresConnector);
    const prompt = buildSystemPrompt(narrowed);
    assert.ok(prompt.includes('web.read'));
    assert.ok(!prompt.includes('  email.send —'));
    assert.ok(!prompt.includes('  whatsapp.send —'));
  });

  it('marks JIT scopes with [JIT]', () => {
    const prompt = buildSystemPrompt(SCOPE_CATALOG);
    assert.ok(prompt.includes('[JIT]'));
  });

  it('omits specialty recipes without packs', () => {
    const prompt = buildSystemPrompt(SCOPE_CATALOG);
    assert.ok(!prompt.includes('Greenhouse'));
    assert.ok(!prompt.includes('gmb_search_leads'));
    assert.ok(prompt.includes('mcp.<server>.<tool>'));
  });

  it('includes lead pack recipes when selected', () => {
    const prompt = buildSystemPrompt(SCOPE_CATALOG, ['leads']);
    assert.ok(prompt.includes('gmb_search_leads'));
  });

  it('includes job pack recipes when selected', () => {
    const prompt = buildSystemPrompt(SCOPE_CATALOG, ['jobs']);
    assert.ok(prompt.includes('mcp.qlix-jobs'));
    assert.ok(prompt.includes('Greenhouse'));
  });

  it('stays under character budget without packs', () => {
    const prompt = buildSystemPrompt(SCOPE_CATALOG);
    const single = JSON.stringify(buildAgentToolSchema(SCOPE_CATALOG));
    const team = JSON.stringify(buildTeamToolSchema(SCOPE_CATALOG));
    const total = prompt.length + single.length + team.length;
    assert.ok(
      total < 8_000,
      `expected core+tools < 8000 chars, got ${total} (prompt=${prompt.length} tools=${single.length + team.length})`,
    );
  });
});
