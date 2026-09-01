import type {
  BuilderReadinessState,
  DiscoveryOutcome,
  RequirementFactView,
} from './discovery.types.js';

const NEGATION_RE =
  /^(no|nope|nah|no thanks|nothing|none|n\/a|na|any|anything|everything|all|all of them|whatever|doesn't matter|does not matter|no preference|no specific|not really)\.?$/i;

const AFFIRM_RE =
  /^(yes|yep|yeah|y|ok|okay|sure|please|do it|go ahead|proceed|design(?:\s+it)?|build(?:\s+it)?|confirm|let'?s go)\b/i;

const READY_OFFER =
  'I have enough to design this. Say the word and I’ll put the plan together.';

function isReadyOffer(text: string | undefined): boolean {
  if (!text) return false;
  return /ready (for me )?to design|enough to design|put the plan together|want me to (design|build|proceed)|say when you want me to design|say the word/i.test(text);
}

export interface NormalizeDiscoveryInput {
  outcome: DiscoveryOutcome;
  factsAfterOps: RequirementFactView[];
  priorUnresolved: Array<{ key: string; question: string; blocking: boolean }>;
  priorAssumptions: string[];
  currentMessage: string;
  lastAssistantReply?: string;
  userTurnNumber: number;
}

function hasCategory(facts: RequirementFactView[], category: string): boolean {
  return facts.some((fact) => fact.category === category);
}

function hasKeyOrValueHint(facts: RequirementFactView[], hints: RegExp): boolean {
  return facts.some((fact) => {
    const blob = `${fact.key} ${typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value ?? '')}`;
    return hints.test(blob);
  });
}

/** Deterministic readiness — never leave canPlan to model whim once the core is known. */
export function computeDeterministicReadiness(
  facts: RequirementFactView[],
  unresolved: Array<{ key: string; question: string; blocking: boolean }>,
): BuilderReadinessState {
  const hasObjective = hasCategory(facts, 'objective')
    || hasKeyOrValueHint(facts, /email|inbox|message|lead|automat/i);
  const hasInput = hasCategory(facts, 'input')
    || hasCategory(facts, 'integration')
    || hasKeyOrValueHint(facts, /email|gmail|outlook|inbox|hubspot|crm|slack|whatsapp/i);
  const hasOutput = hasCategory(facts, 'output')
    || hasCategory(facts, 'workflow')
    || hasKeyOrValueHint(facts, /draft|reply|notif|send|deal|create|summar/i);
  const hasTrigger = hasCategory(facts, 'trigger')
    || hasKeyOrValueHint(facts, /when|arriv|incoming|new_|schedule|trigger/i);

  let score = 0;
  if (hasObjective) score += 0.3;
  if (hasInput) score += 0.25;
  if (hasOutput) score += 0.25;
  if (hasTrigger) score += 0.2;
  else if (hasObjective && hasOutput) score += 0.1; // trigger often defaultable

  const blocking = unresolved.filter((item) => item.blocking).map((item) => item.key);
  const coreKnown = hasObjective && hasOutput && (hasInput || hasTrigger || score >= 0.7);
  const canPlan = coreKnown && blocking.length === 0 && score >= 0.7;

  return {
    score: Math.min(1, Math.round(score * 100) / 100),
    canPlan,
    blocking,
  };
}

function dedupeUnresolved(
  items: Array<{ key: string; question: string; blocking: boolean }>,
): Array<{ key: string; question: string; blocking: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ key: string; question: string; blocking: boolean }> = [];
  for (const item of items) {
    const key = item.key.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function similarText(a: string, b: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(left.split(' ').filter((token) => token.length > 3));
  const rightTokens = right.split(' ').filter((token) => token.length > 3);
  if (rightTokens.length === 0) return false;
  const overlap = rightTokens.filter((token) => leftTokens.has(token)).length;
  return overlap / rightTokens.length >= 0.7;
}

/**
 * Backend hygiene for discovery turns:
 * - "no"/"nothing" answers clear the prior open questions as assumptions
 * - never keep duplicate unresolved keys
 * - never re-ask the same question the assistant just asked
 * - compute readiness from facts, not model mood
 * - once ready, stop inventing optional questions
 */
export function normalizeDiscoveryOutcome(input: NormalizeDiscoveryInput): DiscoveryOutcome {
  const { outcome, factsAfterOps, priorUnresolved, currentMessage, lastAssistantReply, userTurnNumber } = input;
  let assumptions = [...outcome.assumptions, ...input.priorAssumptions]
    .map((item) => item.trim())
    .filter(Boolean);
  assumptions = [...new Set(assumptions)].slice(0, 20);

  let unresolved = dedupeUnresolved(outcome.unresolved);
  const negation = NEGATION_RE.test(currentMessage.trim());
  const affirmation = AFFIRM_RE.test(currentMessage.trim());
  const lastWasReadyOffer = isReadyOffer(lastAssistantReply) || isReadyOffer(outcome.reply);

  if (negation && priorUnresolved.length > 0 && !lastWasReadyOffer) {
    for (const item of priorUnresolved) {
      const assumption = `User declined further restriction for "${item.key}": default broadly / no special filter.`;
      if (!assumptions.includes(assumption)) assumptions.push(assumption);
    }
    const answered = new Set(priorUnresolved.map((item) => item.key.toLowerCase()));
    unresolved = unresolved.filter((item) => !answered.has(item.key.toLowerCase()));
  }

  // Drop unresolved items that are already represented as facts.
  const factKeys = new Set(factsAfterOps.map((fact) => fact.key.toLowerCase()));
  unresolved = unresolved.filter((item) => !factKeys.has(item.key.toLowerCase()));

  // Never block on "where do emails live?" once the user already said email/inbox.
  if (hasKeyOrValueHint(factsAfterOps, /email|inbox|gmail|outlook/i)) {
    unresolved = unresolved.filter((item) => !/input_source|email_client|crm/i.test(item.key));
  }

  // Optional questions are never blocking once we already have objective + action.
  const readinessSeed = computeDeterministicReadiness(factsAfterOps, unresolved);
  if (readinessSeed.canPlan || (readinessSeed.score >= 0.55 && userTurnNumber >= 3)) {
    unresolved = unresolved
      .filter((item) => item.blocking)
      .slice(0, 1);
  }

  // Default trigger for inbox-style agents when the user never specified one.
  if (
    !hasCategory(factsAfterOps, 'trigger')
    && hasKeyOrValueHint(factsAfterOps, /email|inbox|gmail|outlook/i)
    && !assumptions.some((item) => /trigger|incoming email|new email/i.test(item))
  ) {
    assumptions.push('Trigger defaults to new/incoming emails unless the user specified otherwise.');
  }

  const readiness = computeDeterministicReadiness(factsAfterOps, unresolved);
  // After enough turns with solid coverage, force ready even if model keeps probing.
  const forceReady = readiness.canPlan
    || (userTurnNumber >= 3 && readiness.score >= 0.55 && readiness.blocking.length === 0);

  let action = outcome.action;
  let reply = outcome.reply.trim();

  if (lastWasReadyOffer && affirmation && readiness.score >= 0.55) {
    readiness.canPlan = true;
    readiness.score = Math.max(readiness.score, 0.9);
    unresolved = [];
    action = 'plan';
    reply = reply || 'Designing that now.';
  } else if (lastWasReadyOffer && negation) {
    readiness.canPlan = true;
    readiness.score = Math.max(readiness.score, 0.85);
    unresolved = [];
    action = 'ready';
    reply = 'No problem — say when you want me to design it.';
  } else {
    const repeating =
      Boolean(lastAssistantReply && similarText(lastAssistantReply, reply))
      || unresolved.some((item) => Boolean(lastAssistantReply && similarText(lastAssistantReply, item.question)))
      || Boolean(negation && lastAssistantReply && similarText(lastAssistantReply, reply));

    if (forceReady) {
      readiness.canPlan = true;
      readiness.score = Math.max(readiness.score, 0.85);
      unresolved = [];
      if (action === 'continue' || repeating || !isReadyOffer(reply)) {
        action = 'ready';
        reply = READY_OFFER;
      }
    } else if (repeating) {
      // User already answered; do not echo the same question.
      unresolved = unresolved.filter(
        (item) => !(lastAssistantReply && similarText(lastAssistantReply, item.question)),
      );
      if (negation) {
        reply = readiness.canPlan
          ? READY_OFFER
          : 'Understood — no special filters. What’s the one remaining must-have for this agent?';
      }
    }
  }

  // Cap optional probing: never return more than one unresolved question.
  unresolved = unresolved.slice(0, 1);

  if (!readiness.canPlan && action !== 'continue') {
    action = 'continue';
  }
  if (userTurnNumber <= 1 && action === 'plan') {
    action = readiness.canPlan ? 'ready' : 'continue';
  }

  return {
    ...outcome,
    reply,
    unresolved,
    assumptions: assumptions.slice(0, 20),
    readiness,
    action,
    summary: outcome.summary || assumptions.slice(0, 3).join(' '),
  };
}
