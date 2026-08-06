import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHeuristicRoute,
  buildDisambiguationOptions,
  formatDisambiguationMenu,
  parseDisambiguationSelection,
  routeHintForConfidence,
  type IntentRosterAgent,
  type IntentRouteDecision,
} from './whatsappIntentRouter.js';
import { parseWhatsAppRunModifiers } from './whatsappRunModifiers.js';

const hybridAgent: IntentRosterAgent = {
  id: 'hybrid-1',
  name: 'local',
  description: 'Local PC assistant',
  permissionScopes: ['system.file_read'],
  runtime: 'hybrid',
  online: true,
  roleMission: null,
};

const cloudAgent: IntentRosterAgent = {
  id: 'cloud-1',
  name: 'researcher',
  description: 'Web research',
  permissionScopes: ['web.read'],
  runtime: 'cloud',
  online: true,
  roleMission: null,
};

describe('parseDisambiguationSelection', () => {
  it('accepts valid numeric picks', () => {
    assert.equal(parseDisambiguationSelection('1', 3), 0);
    assert.equal(parseDisambiguationSelection('3', 3), 2);
  });

  it('rejects out of range or non-numeric', () => {
    assert.equal(parseDisambiguationSelection('4', 3), null);
    assert.equal(parseDisambiguationSelection('hello', 3), null);
    assert.equal(parseDisambiguationSelection('1.5', 3), null);
  });
});

describe('formatDisambiguationMenu', () => {
  it('lists numbered agent options', () => {
    const options = buildDisambiguationOptions([hybridAgent, cloudAgent]);
    const menu = formatDisambiguationMenu(options);
    assert.match(menu, /^I can help — which agent/);
    assert.match(menu, /1\. local/);
    assert.match(menu, /2\. researcher/);
    assert.match(menu, /Reply 1–2/);
  });
});

describe('routeHintForConfidence', () => {
  it('shows hint only in mid-confidence band', () => {
    const high: IntentRouteDecision = {
      targetType: 'agent',
      targetId: 'x',
      targetName: 'local',
      confidence: 0.9,
      reason: 'file task',
      source: 'heuristic',
    };
    const mid: IntentRouteDecision = { ...high, confidence: 0.6 };
    const low: IntentRouteDecision = { ...high, confidence: 0.2 };

    assert.equal(routeHintForConfidence(high), null);
    assert.equal(routeHintForConfidence(mid), 'file task');
    assert.equal(routeHintForConfidence(low), null);
  });
});

describe('applyHeuristicRoute', () => {
  it('picks the only agent without LLM', () => {
    const decision = applyHeuristicRoute('hello', [cloudAgent], null);
    assert.equal(decision?.targetId, 'cloud-1');
    assert.equal(decision?.source, 'single');
  });

  it('uses default agent for short messages', () => {
    const decision = applyHeuristicRoute('hi', [cloudAgent, hybridAgent], hybridAgent.id);
    assert.equal(decision?.targetId, 'hybrid-1');
    assert.equal(decision?.source, 'default');
  });

  it('routes PC file tasks to online hybrid with file scope', () => {
    const decision = applyHeuristicRoute(
      'Read C:\\logs\\debug.log on my PC',
      [cloudAgent, hybridAgent],
      null,
    );
    assert.equal(decision?.targetId, 'hybrid-1');
    assert.equal(decision?.source, 'heuristic');
    assert.ok(decision!.confidence >= 0.75);
  });

  it('returns null when multiple agents and no strong signal', () => {
    const decision = applyHeuristicRoute(
      'Summarize quarterly revenue trends',
      [cloudAgent, hybridAgent],
      null,
    );
    assert.equal(decision, null);
  });
});

describe('parseWhatsAppRunModifiers with plain text', () => {
  it('leaves plain prompts unchanged for intent routing', () => {
    const r = parseWhatsAppRunModifiers('Summarize today audit log');
    assert.equal(r.useBrain, false);
    assert.equal(r.text, 'Summarize today audit log');
  });

  it('still strips #brain from plain prompts', () => {
    const r = parseWhatsAppRunModifiers('Follow policy #brain for loan review');
    assert.equal(r.useBrain, true);
    assert.match(r.text, /loan review/);
    assert.doesNotMatch(r.text, /#brain/);
  });
});
