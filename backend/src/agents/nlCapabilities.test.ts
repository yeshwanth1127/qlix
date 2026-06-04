import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FORCE_JIT_SCOPES } from './jit.js';
import { buildAgentToolSchema, buildTeamToolSchema, buildSystemPrompt } from './nlCapabilities.js';
import { ALL_PERMISSION_SCOPES } from './agents.types.js';

describe('jit.ts', () => {
  it('includes email.send in FORCE_JIT_SCOPES', () => {
    assert.ok(FORCE_JIT_SCOPES.includes('email.send'));
  });

  it('has 6 JIT-forced scopes', () => {
    assert.equal(FORCE_JIT_SCOPES.length, 6);
  });
});

describe('buildAgentToolSchema', () => {
  it('returns plan_single_agent function tool', () => {
    const tool = buildAgentToolSchema() as any;
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.name, 'plan_single_agent');
  });

  it('permissionScopes enum matches ALL_PERMISSION_SCOPES', () => {
    const tool = buildAgentToolSchema() as any;
    const scopeEnum = tool.function.parameters.properties.agent.properties.permissionScopes.items.enum;
    assert.deepEqual(scopeEnum, ALL_PERMISSION_SCOPES);
  });

  it('runtime enum has all three values', () => {
    const tool = buildAgentToolSchema() as any;
    const runtimeEnum = tool.function.parameters.properties.agent.properties.runtime.enum;
    assert.deepEqual(runtimeEnum, ['cloud', 'hybrid', 'local']);
  });

  it('required fields include all agent properties', () => {
    const tool = buildAgentToolSchema() as any;
    const required: string[] = tool.function.parameters.properties.agent.required;
    for (const field of ['name', 'description', 'permissionScopes', 'jitScopes', 'runtime', 'model', 'llmMode', 'localInferenceMode']) {
      assert.ok(required.includes(field), `missing required field: ${field}`);
    }
  });
});

describe('buildTeamToolSchema', () => {
  it('returns plan_team function tool', () => {
    const tool = buildTeamToolSchema() as any;
    assert.equal(tool.function.name, 'plan_team');
  });

  it('workers items include role and stageOrder', () => {
    const tool = buildTeamToolSchema() as any;
    const workerRequired: string[] = tool.function.parameters.properties.team.properties.workers.items.required;
    assert.ok(workerRequired.includes('role'));
    assert.ok(workerRequired.includes('stageOrder'));
  });

  it('config has all three retry policies', () => {
    const tool = buildTeamToolSchema() as any;
    const retryEnum = tool.function.parameters.properties.team.properties.config.properties.retryPolicy.enum;
    assert.deepEqual(retryEnum, ['none', 'once', 'twice']);
  });
});

describe('buildSystemPrompt', () => {
  it('contains all FORCE_JIT_SCOPES', () => {
    const prompt = buildSystemPrompt();
    for (const scope of FORCE_JIT_SCOPES) {
      assert.ok(prompt.includes(scope), `prompt missing JIT scope: ${scope}`);
    }
  });

  it('contains all permission scopes', () => {
    const prompt = buildSystemPrompt();
    for (const scope of ALL_PERMISSION_SCOPES) {
      assert.ok(prompt.includes(scope), `prompt missing scope: ${scope}`);
    }
  });

  it('marks JIT scopes with [JIT-forced]', () => {
    const prompt = buildSystemPrompt();
    assert.ok(prompt.includes('[JIT-forced]'));
  });

  it('contains delivery channel rule', () => {
    const prompt = buildSystemPrompt();
    assert.ok(prompt.includes('WhatsApp'));
    assert.ok(prompt.includes('BUILT-IN'));
  });
});
