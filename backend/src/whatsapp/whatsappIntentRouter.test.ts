import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHeuristicRoute,
  buildDisambiguationOptions,
  formatDisambiguationMenu,
  parseDisambiguationSelection,
  routeHintForConfidence,
  scoreAgents,
  topKAgentsForLlm,
  type IntentRosterAgent,
  type IntentRouteDecision,
} from './whatsappIntentRouter.js';
import { parseWhatsAppRunModifiers } from './whatsappRunModifiers.js';

const hybridAgent: IntentRosterAgent = {
  id: 'hybrid-1',
  name: 'local',
  description: 'Local PC assistant for field support log review',
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

const emailAgent: IntentRosterAgent = {
  id: 'email-1',
  name: 'mailer',
  description: 'Inbox triage',
  permissionScopes: ['email.read', 'email.send'],
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

  it('routes by agent name mention', () => {
    const decision = applyHeuristicRoute(
      'Ask researcher to summarize quarterly revenue',
      [cloudAgent, hybridAgent],
      null,
    );
    assert.equal(decision?.targetId, 'cloud-1');
    assert.equal(decision?.source, 'heuristic');
    assert.ok((decision?.confidence ?? 0) >= 0.9);
  });

  it('uses default agent when there is no strong signal', () => {
    const decision = applyHeuristicRoute(
      'Summarize quarterly revenue trends for the board',
      [cloudAgent, hybridAgent],
      hybridAgent.id,
    );
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

  it('routes email capability keywords to email-scoped agent', () => {
    const decision = applyHeuristicRoute(
      'Check my inbox and summarize unread email',
      [cloudAgent, hybridAgent, emailAgent],
      null,
    );
    assert.equal(decision?.targetId, 'email-1');
    assert.equal(decision?.source, 'heuristic');
  });

  it('returns null on a close race so LLM can decide', () => {
    const twin: IntentRosterAgent = {
      ...cloudAgent,
      id: 'cloud-2',
      name: 'analyst',
      description: 'Web research and market analysis',
      permissionScopes: ['web.read', 'web.research'],
    };
    const decision = applyHeuristicRoute(
      'Please research competitor pricing online',
      [cloudAgent, twin],
      null,
    );
    assert.equal(decision, null);
  });
});

describe('scoreAgents / topKAgentsForLlm', () => {
  it('ranks hybrid higher for PC tasks', () => {
    const scores = scoreAgents('Open C:\\tmp\\a.log on my computer', [cloudAgent, hybridAgent], null);
    assert.equal(scores[0]?.agent.id, 'hybrid-1');
    assert.ok((scores[0]?.score ?? 0) > (scores[1]?.score ?? 0));
  });

  it('limits LLM candidates to top K', () => {
    const top = topKAgentsForLlm(
      'search the web for news',
      [hybridAgent, cloudAgent, emailAgent],
      null,
      2,
    );
    assert.equal(top.length, 2);
    assert.equal(top[0]?.id, 'cloud-1');
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
