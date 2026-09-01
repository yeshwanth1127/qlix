import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPABILITY_GRANT_ACTION,
  capabilityGrantScopeLabel,
  isCapabilityGrantAction,
  labelsForCapabilityScopes,
  remapCapabilityScopesForRuntime,
} from './capabilityGrant.service.js';
import type { PermissionScope } from '../agents/agents.types.js';

describe('capabilityGrant helpers', () => {
  it('recognizes the grant action type', () => {
    assert.equal(isCapabilityGrantAction(CAPABILITY_GRANT_ACTION), true);
    assert.equal(isCapabilityGrantAction('email.send'), false);
  });

  it('labels scopes from the tool payload', () => {
    const label = capabilityGrantScopeLabel({
      toolPayload: {
        scopes: ['email.send', 'web.research'],
        reason: 'User asked to email results',
      },
    });
    assert.match(label, /email/i);
  });

  it('labels PDF asks as Create PDF documents, not Write local files', () => {
    assert.equal(
      labelsForCapabilityScopes(['system.file_write'], 'Need to create a PDF of the script'),
      'Create PDF documents',
    );
    assert.equal(
      labelsForCapabilityScopes(['files.create'], 'create a pdf for this'),
      'Create PDF documents',
    );
  });

  it('remaps cloud file_write PDF asks to files.create', () => {
    const remapped = remapCapabilityScopesForRuntime({
      scopes: ['system.file_write'] as PermissionScope[],
      reason: 'Create a PDF of the prior Result',
      runtime: 'cloud',
    });
    assert.deepEqual(remapped, ['files.create']);
  });

  it('keeps file_write on hybrid for desktop PDF', () => {
    const remapped = remapCapabilityScopesForRuntime({
      scopes: ['system.file_write'] as PermissionScope[],
      reason: 'Create a PDF of the prior Result',
      runtime: 'hybrid',
    });
    assert.deepEqual(remapped, ['system.file_write']);
  });

  it('falls back when scopes are missing', () => {
    assert.equal(capabilityGrantScopeLabel({}), 'Add capability');
  });
});
