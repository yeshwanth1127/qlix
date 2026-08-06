import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  pickSlackChannelList,
  resolveSelectChoiceValue,
  slackListRichText,
  type SlackListColumn,
} from './slackListHelpers.js';

describe('Slack List helpers', () => {
  it('returns only an exact select-option match', () => {
    const column: SlackListColumn = {
      id: 'ColStatus',
      name: 'Status',
      key: 'status',
      type: 'select',
      isPrimary: false,
      selectChoices: [
        { value: 'not_started', label: 'Not started' },
        { value: 'in_progress', label: 'In progress' },
      ],
    };
    assert.equal(resolveSelectChoiceValue(column, 'In progress'), 'in_progress');
    assert.equal(resolveSelectChoiceValue(column, 'progress'), null);
  });

  it('requires an explicit choice for multiple trackers', () => {
    const result = pickSlackChannelList([
      { listId: 'FONE', title: 'Project tracker', tabLabel: null, todoMode: true, source: 'channel_tab' },
      { listId: 'FTWO', title: 'Sprint tracker', tabLabel: null, todoMode: true, source: 'channel_tab' },
    ]);
    assert.equal(result.list, null);
    assert.equal(result.candidates.length, 2);
  });

  it('selects the single matching tracker by exact title', () => {
    const result = pickSlackChannelList(
      [
        { listId: 'FONE', title: 'Project tracker', tabLabel: null, todoMode: true, source: 'channel_tab' },
        { listId: 'FTWO', title: 'Sprint tracker', tabLabel: null, todoMode: true, source: 'channel_tab' },
      ],
      'Sprint tracker',
    );
    assert.equal(result.list?.listId, 'FTWO');
    assert.deepEqual(result.candidates, []);
  });

  it('creates Slack rich text cells', () => {
    assert.deepEqual(slackListRichText('Task'), [
      {
        type: 'rich_text',
        elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Task' }] }],
      },
    ]);
  });
});
