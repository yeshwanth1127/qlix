import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inferLiveArtifactFormatFromGoal,
  previewKindForFormat,
} from './liveArtifactFormat.js';

describe('inferLiveArtifactFormatFromGoal', () => {
  it('detects common document types from goal text', () => {
    assert.equal(
      inferLiveArtifactFormatFromGoal('wait for replies and send me a pdf'),
      'pdf',
    );
    assert.equal(
      inferLiveArtifactFormatFromGoal('build a powerpoint deck of responders'),
      'pptx',
    );
    assert.equal(
      inferLiveArtifactFormatFromGoal('keep a live excel sheet'),
      'xlsx',
    );
  });
});

describe('previewKindForFormat', () => {
  it('maps formats to UI preview modes', () => {
    assert.equal(previewKindForFormat('xlsx'), 'table');
    assert.equal(previewKindForFormat('pdf'), 'pdf');
    assert.equal(previewKindForFormat('pptx'), 'office');
  });
});
