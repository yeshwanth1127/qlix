import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInitialConversationState, transitionConversation } from './conversationRuntime.js';
import type { ConversationWorkflow } from './workflow.types.js';
import { compileConversationWorkflow } from './workflowCompiler.js';
import { constrainedClassifierPlugin } from './conversationPlugins.js';

const outreach: ConversationWorkflow = {
  key: 'education_interest',
  version: 1,
  entryNodeId: 'greet',
  nodes: [
    { id: 'greet', type: 'send', content: 'Hello {{name}}', next: 'interest' },
    { id: 'interest', type: 'collect', content: 'Would you like details?', variable: 'interest', validation: { allowed: ['yes', 'no'], retryPrompt: 'Please reply Yes or No.' }, next: 'interest_branch' },
    { id: 'interest_branch', type: 'branch', variable: 'interest', cases: [{ equals: 'yes', next: 'city' }, { equals: 'no', next: 'decline' }], default: 'decline' },
    { id: 'city', type: 'collect', content: 'Which city?', variable: 'city', next: 'done' },
    { id: 'decline', type: 'send', content: 'Thanks for letting us know.', next: 'done' },
    { id: 'done', type: 'complete', result: { interest: '{{interest}}', city: '{{city}}' } },
  ],
};

describe('conversation runtime', () => {
  it('runs deterministic nested branches and preserves collected variables', () => {
    const workflow = compileConversationWorkflow(outreach);
    let transition = transitionConversation(
      createInitialConversationState(workflow, { name: 'Raghu' }),
      workflow,
      { type: 'start' },
    );
    assert.equal(transition.state.status, 'waiting_input');
    assert.deepEqual(transition.effects.map((effect) => effect.type), ['send', 'send']);
    assert.equal(transition.effects[0]?.type === 'send' && transition.effects[0].content, 'Hello Raghu');

    transition = transitionConversation(transition.state, workflow, { type: 'inbound', text: 'YES' });
    assert.equal(transition.state.status, 'waiting_input');
    assert.equal(transition.state.currentNodeId, 'city');
    assert.equal(transition.effects[0]?.type === 'send' && transition.effects[0].content, 'Which city?');

    transition = transitionConversation(transition.state, workflow, { type: 'inbound', text: 'Bangalore' });
    assert.equal(transition.state.status, 'completed');
    assert.deepEqual(transition.result, { interest: 'YES', city: 'Bangalore' });
  });

  it('re-prompts invalid constrained input with a new operation id', () => {
    const workflow = compileConversationWorkflow(outreach);
    const started = transitionConversation(createInitialConversationState(workflow), workflow, { type: 'start' });
    const retried = transitionConversation(started.state, workflow, { type: 'inbound', text: 'maybe' });
    assert.equal(retried.state.status, 'waiting_input');
    assert.equal(retried.effects[0]?.type === 'send' && retried.effects[0].content, 'Please reply Yes or No.');
    assert.equal(retried.effects[0]?.operationIndex, 2);
  });

  it('takes the negative branch without asking positive-path questions', () => {
    const workflow = compileConversationWorkflow(outreach);
    const started = transitionConversation(createInitialConversationState(workflow), workflow, { type: 'start' });
    const declined = transitionConversation(started.state, workflow, { type: 'inbound', text: 'no' });
    assert.equal(declined.state.status, 'completed');
    assert.deepEqual(declined.effects.map((effect) => effect.type), ['send']);
    assert.equal(declined.effects[0]?.type === 'send' && declined.effects[0].content, 'Thanks for letting us know.');
  });

  it('resumes actions and timers without involving an LLM', () => {
    const workflow = compileConversationWorkflow({
      key: 'action_timer', version: 1, entryNodeId: 'act', nodes: [
        { id: 'act', type: 'action', action: 'crm.upsert', input: { phone: '{{phone}}' }, resultVariable: 'crm', next: 'delay' },
        { id: 'delay', type: 'wait', delayMs: 5000, next: 'done' },
        { id: 'done', type: 'complete' },
      ],
    });
    const started = transitionConversation(createInitialConversationState(workflow, { phone: '123' }), workflow, { type: 'start' });
    assert.equal(started.state.status, 'waiting_action');
    const acted = transitionConversation(started.state, workflow, { type: 'action_result', actionId: 'a', ok: true, result: { id: 'lead-1' } });
    assert.equal(acted.state.status, 'waiting_timer');
    assert.equal(acted.effects[0]?.type, 'timer');
    const fired = transitionConversation(acted.state, workflow, { type: 'timer_fired' });
    assert.equal(fired.state.status, 'completed');
  });

  it('matches known intents deterministically and constrains ambiguous classification', () => {
    const workflow = compileConversationWorkflow({
      key: 'classifier', version: 1, entryNodeId: 'ask', nodes: [
        { id: 'ask', type: 'ask', content: 'Interested?', variable: 'answer', next: 'classify' },
        { id: 'classify', type: 'classify', variable: 'answer', intents: [
          { label: 'yes', examples: ['yep'], next: 'yes' },
          { label: 'no', examples: ['nope'], next: 'no' },
        ], unclearNext: 'clarify' },
        { id: 'yes', type: 'complete' },
        { id: 'no', type: 'complete' },
        { id: 'clarify', type: 'complete' },
      ],
    });
    const started = transitionConversation(createInitialConversationState(workflow), workflow, { type: 'start' });
    const exact = transitionConversation(started.state, workflow, { type: 'inbound', text: 'Yep' });
    assert.equal(exact.state.status, 'completed');
    assert.equal((exact.state.variables.answerClassification as { method: string }).method, 'deterministic');

    const restarted = transitionConversation(createInitialConversationState(workflow), workflow, { type: 'start' });
    const unclear = transitionConversation(restarted.state, workflow, { type: 'inbound', text: 'possibly' });
    assert.equal(unclear.state.status, 'waiting_action');
    assert.deepEqual(
      unclear.effects[0]?.type === 'action' && unclear.effects[0].input.allowedIntents,
      ['yes', 'no'],
    );
    const lowConfidence = transitionConversation(unclear.state, workflow, {
      type: 'action_result', actionId: 'classifier', ok: true, result: { label: 'yes', confidence: 0.4 },
    });
    assert.equal(lowConfidence.state.status, 'completed');
    assert.equal(
      (lowConfidence.state.variables.answerClassification as { label: string }).label,
      'unclear',
    );
  });
});

describe('conversation workflow compiler', () => {
  it('rejects missing destinations and unreachable nodes', () => {
    assert.throws(() => compileConversationWorkflow({
      key: 'bad', version: 1, entryNodeId: 'start', nodes: [
        { id: 'start', type: 'send', content: 'x', next: 'missing' },
      ],
    }), /missing node/);
    assert.throws(() => compileConversationWorkflow({
      key: 'bad', version: 1, entryNodeId: 'done', nodes: [
        { id: 'done', type: 'complete' },
        { id: 'orphan', type: 'complete' },
      ],
    }), /Unreachable/);
  });
});

describe('conversation classifier plugin', () => {
  it('cannot return an intent outside the workflow allowlist', async () => {
    const plugin = constrainedClassifierPlugin(async () => ({ label: 'arbitrary_node', confidence: 1 }));
    const input = plugin.validate({ text: 'something', allowedIntents: ['yes', 'no'] });
    const result = await plugin.execute(
      { orgId: 'org', threadId: 'thread', idempotencyKey: 'key' },
      input,
    );
    assert.deepEqual(result, { label: 'unclear', confidence: 0 });
  });
});
