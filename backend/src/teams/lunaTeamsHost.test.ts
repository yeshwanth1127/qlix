import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindIntentRequirements,
  parseLunaTeamsHandback,
  DEFAULT_RESULT_CONTRACT,
  TOOL_EVIDENCE_RESULT_CONTRACT,
  effectiveOutputContract,
  renderLunaTeamsFinal,
  renderContextReferenceIndex,
  renderResultHandbacks,
  resolveDispatchKnowledgeMode,
  resolveDispatchAllowedScopes,
  resolveDispatchResultPolicy,
  resultRepairPrompt,
  skillsForLunaTeamsDispatch,
  TEAM_DISPATCH_ONLY_SKILL,
  validateLunaTeamsResult,
} from './lunaTeamsHost.js';
import type { TeamRunDTO } from './teams.types.js';

test('parses structured worker handbacks without changing the worker runtime', () => {
  const result = parseLunaTeamsHandback(
    '{"summary":"2 records","findings":{"records":[{"id":1},{"id":2}]}}',
  );
  assert.equal(result.summary, '2 records');
  assert.deepEqual(result.payload, {
    summary: '2 records',
    findings: { records: [{ id: 1 }, { id: 2 }] },
  });
});

test('parses string-encoded and double-encoded Result envelopes from runners', () => {
  const payload = {
    summary: 'Drafted scene',
    findings: { title: 'The Quiet Floor' },
    artifacts: [],
    provenance: { inputRefs: [], recordRefs: [], knowledgeRefs: [] },
  };
  for (const encoded of [JSON.stringify(payload), JSON.stringify(JSON.stringify(payload))]) {
    const result = parseLunaTeamsHandback(encoded);
    assert.equal(result.summary, 'Drafted scene');
    assert.deepEqual(result.payload, payload);
  }
});

test('accepts a creative first-stage Result with empty lineage', () => {
  const payload = {
    summary: 'Drafted scene',
    findings: { title: 'The Quiet Floor' },
    artifacts: [],
    provenance: { inputRefs: [], recordRefs: [], knowledgeRefs: [] },
  };
  const result = validateLunaTeamsResult({
    run: { inputs: [] } as TeamRunDTO,
    dispatch: {
      inputRefs: [],
      allowedSources: ['authoritative_input'],
      knowledgeMode: 'none',
      outputContract: DEFAULT_RESULT_CONTRACT,
    },
    payload,
  });
  assert.deepEqual(result.provenance.inputRefs, []);
  assert.deepEqual(result.provenance.recordRefs, []);
});

test('renders only Result payloads as downstream context', () => {
  const context = renderResultHandbacks([
    { agentName: 'Filter', payload: { records: [{ id: 1 }] } },
  ]);
  assert.match(context, /authoritative/);
  assert.match(context, /"id":1/);
});

test('referenced Team context sends an index instead of copying Result payloads', () => {
  const context = renderContextReferenceIndex([{
    agentName: 'Researcher',
    contextRef: 'ctx:cm123:v1:aaaaaaaaaaaa',
    summary: 'Found the required records',
    payload: { veryLargePrivatePayload: 'must-not-be-inlined' },
  }]);
  assert.match(context, /ctx:cm123:v1:aaaaaaaaaaaa/);
  assert.match(context, /Found the required records/);
  assert.doesNotMatch(context, /veryLargePrivatePayload/);
});

test('final response is deterministic and does not launch a recap agent', () => {
  const final = renderLunaTeamsFinal([
    { agentName: 'Researcher', summary: 'Found facts', findings: 'facts', status: 'completed' },
    { agentName: 'Writer', summary: 'Wrote report', findings: 'final report', status: 'completed' },
  ]);
  assert.match(final, /Final result from Writer/);
  assert.match(final, /final report/);
});

test('external WhatsApp reply result is not counted as a worker dispatch', () => {
  const final = renderLunaTeamsFinal([
    { agentName: 'Lead Filter', summary: 'Filtered leads', findings: 'leads', status: 'completed', subtaskId: 'filter' },
    { agentName: 'WhatsApp Messenger', summary: 'Queued outreach', findings: 'queued', status: 'completed', subtaskId: 'outreach' },
    { agentName: 'WhatsApp replies', summary: 'One reply', findings: 'one interested', status: 'completed', subtaskId: 'external_whatsapp_reply' },
  ]);
  assert.match(final, /Team completed 2 worker dispatches/);
  assert.match(final, /Final result from WhatsApp replies/);
});

const incidentRun = {
  inputs: [
    {
      id: 'sheet',
      ref: 'team-input:sheet',
      fileName: 'Sample.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      url: 'sandbox://sheet',
      sizeBytes: 1,
      sha256: 'sheet-hash',
      purpose: 'authoritative_input',
      extractedText:
        'Name,Phone,City\nAarav,+919111111111,Bangalore\nRohan,+919222222222,Chennai\nKarthik,+919333333333,Delhi',
    },
    {
      id: 'brochure',
      ref: 'team-input:brochure',
      fileName: 'Brochure.pdf',
      mimeType: 'application/pdf',
      url: 'sandbox://brochure',
      sizeBytes: 1,
      sha256: 'brochure-hash',
      purpose: 'reference_asset',
      extractedText: 'Call 9442592170 or 9187698639. Bengaluru office.',
    },
  ],
} as TeamRunDTO;

const filterDispatch = {
  inputRefs: ['team-input:sheet'],
  allowedSources: ['authoritative_input'] as const,
  knowledgeMode: 'none' as const,
  outputContract: DEFAULT_RESULT_CONTRACT,
};

test('incident regression accepts only spreadsheet records with row provenance', () => {
  const result = validateLunaTeamsResult({
    run: incidentRun,
    dispatch: filterDispatch,
    payload: {
      summary: 'One Bangalore lead',
      findings: { leads: [{ name: 'Aarav', phone: '+919111111111', city: 'Bangalore' }] },
      provenance: {
        inputRefs: ['team-input:sheet'],
        recordRefs: ['team-input:sheet:row:2'],
        knowledgeRefs: [],
      },
    },
  });
  assert.equal(result.provenance.recordRefs[0], 'team-input:sheet:row:2');
});

test('tool-sourced Results use backend-owned tools and recover nested evidence refs', () => {
  const result = validateLunaTeamsResult({
    run: { ...incidentRun, inputs: [] },
    dispatch: {
      inputRefs: [],
      allowedSources: ['authoritative_input'],
      knowledgeMode: 'none',
      outputContract: TOOL_EVIDENCE_RESULT_CONTRACT,
      resultPolicy: 'tool_evidence.v1',
    },
    executedToolRefs: ['assessment_evidence_search'],
    payload: {
      summary: 'Assessment finding',
      findings: [{ criterion: 'planning', evidenceRefs: ['evidence-1'] }],
      provenance: {
        inputRefs: ['team-input:invented'],
        recordRefs: ['team-input:invented:row:1'],
        knowledgeRefs: [],
        toolRefs: ['assessment_artifact_read'],
      },
    },
  });
  assert.deepEqual(result.provenance.toolRefs, ['assessment_evidence_search']);
  assert.deepEqual(result.provenance.evidenceRefs, ['evidence-1']);
  assert.deepEqual(result.provenance.inputRefs, []);
});

test('assessment dispatches automatically use tool evidence instead of a stale Team default', () => {
  assert.equal(resolveDispatchResultPolicy({
    configured: 'lineage.v1',
    role: 'Full Stack Process Examiner',
    task: 'Assess Work Session sessionId=abc against the framework criteria.',
    allowedScopes: ['assessment.evidence.read'],
  }), 'tool_evidence.v1');
  assert.equal(resolveDispatchResultPolicy({
    configured: 'lineage.v1',
    role: 'Lead filter',
    task: 'Filter the attached spreadsheet.',
    allowedScopes: [],
  }), 'lineage.v1');
});

test('Result repair retries preserve the good candidate and prohibit more tool calls', () => {
  const prompt = resultRepairPrompt({
    validationError: 'Result cites a source file but this dispatch has no attached input',
    previousCandidate: '{"summary":"valid assessment"}',
    originalPrompt: 'Return assessment JSON.',
  });
  assert.match(prompt, /exactly this reason: Result cites a source file/);
  assert.match(prompt, /valid assessment/);
  assert.match(prompt, /Do not call tools/);
});

test('empty worker output is a missing Result, not a provenance incident', () => {
  const parsed = parseLunaTeamsHandback('No response generated.');
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: incidentRun,
        dispatch: filterDispatch,
        payload: parsed.payload,
      }),
    /Worker did not return a Result envelope/,
  );
});

test('truncated Result JSON is reported as cut off, not a missing summary', () => {
  const parsed = parseLunaTeamsHandback('{"summary": "Prepared outreach", "findings": {');
  assert.equal(parsed.truncated, true);
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: incidentRun,
        dispatch: filterDispatch,
        payload: parsed.payload,
      }),
    /Worker Result JSON was cut off/,
  );
});

test('filter dispatches do not receive CRM or research skills', () => {
  const skills = skillsForLunaTeamsDispatch({
    role: 'filtering',
    task: 'Filter leads by city, Bangalore, from the provided file.',
    delegatedScopes: ['crm.write', 'web.research', 'mcp.qlix-schedule.schedule_create'],
    knowledgeMode: 'none',
  });
  assert.deepEqual(skills, [TEAM_DISPATCH_ONLY_SKILL]);
});

test('pdf export dispatches receive files.create when delegated', () => {
  const allowed = resolveDispatchAllowedScopes({
    role: 'story',
    task: 'Create a PDF of the screenplay scene The Threshold',
    delegatedScopes: ['brain.query', 'files.create', 'system.file_write'],
    knowledgeMode: 'none',
  });
  assert.deepEqual(allowed, ['files.create', 'system.file_write']);
  assert.deepEqual(
    skillsForLunaTeamsDispatch({
      allowedScopes: allowed,
      task: 'Create a PDF of the screenplay scene',
      delegatedScopes: ['files.create'],
    }),
    ['files.create', 'system.file_write'],
  );
});

test('examiner dispatches receive their delegated assessment tools', () => {
  const allowed = resolveDispatchAllowedScopes({
    role: 'process_integrity',
    task: 'Examine Work Session sessionId=abc and cite evidence for every criterion.',
    delegatedScopes: [
      'assessment.session.get',
      'assessment.evidence.search',
      'assessment.evidence.read',
      'assessment.snapshot.read',
      'assessment.record',
      'crm.write',
    ],
    knowledgeMode: 'none',
  });
  assert.deepEqual(allowed, [
    'assessment.session.get',
    'assessment.evidence.search',
    'assessment.evidence.read',
    'assessment.snapshot.read',
    'assessment.record',
  ]);
  assert.ok(!allowed.includes('crm.write'));
});

test('commander allowedScopes cannot exceed the task heuristic', () => {
  const allowed = resolveDispatchAllowedScopes({
    role: 'outreach',
    task: 'Send a WhatsApp greeting to the filtered leads',
    delegatedScopes: ['crm.write', 'whatsapp.contact_send'],
    knowledgeMode: 'none',
    requested: ['whatsapp.contact_send', 'crm.write', 'email.send'],
  });
  assert.deepEqual(allowed, ['whatsapp.contact_send']);
});

test('commander cannot add connector tools to a filter-only dispatch', () => {
  const allowed = resolveDispatchAllowedScopes({
    role: 'filtering',
    task: 'Filter Bangalore leads',
    delegatedScopes: ['crm.write', 'whatsapp.contact_send'],
    knowledgeMode: 'none',
    requested: ['crm.write'],
  });
  assert.deepEqual(allowed, []);
});

test('commander empty allowedScopes means no connector tools', () => {
  const allowed = resolveDispatchAllowedScopes({
    role: 'filtering',
    task: 'Filter Bangalore leads',
    delegatedScopes: ['crm.write', 'web.research'],
    knowledgeMode: 'none',
    requested: [],
  });
  assert.deepEqual(allowed, []);
  assert.deepEqual(skillsForLunaTeamsDispatch({ allowedScopes: allowed }), [TEAM_DISPATCH_ONLY_SKILL]);
});

test('invented commander scopes are dropped', () => {
  const allowed = resolveDispatchAllowedScopes({
    role: 'outreach',
    task: 'Message the leads on WhatsApp',
    delegatedScopes: ['whatsapp.contact_send'],
    knowledgeMode: 'none',
    requested: ['crm.write', 'whatsapp.contact_send'],
  });
  assert.deepEqual(allowed, ['whatsapp.contact_send']);
});

test('whatsapp dispatches keep channel scopes and drop CRM', () => {
  const skills = skillsForLunaTeamsDispatch({
    role: 'outreach',
    task: 'Send a WhatsApp greeting, brochure, and poll to the validated leads.',
    delegatedScopes: ['whatsapp.contact_send', 'whatsapp.auto_reply', 'crm.write'],
    knowledgeMode: 'none',
  });
  assert.ok(skills.includes('whatsapp.contact_send'));
  assert.ok(skills.includes('whatsapp.auto_reply'));
  assert.ok(!skills.includes('crm.write'));
  assert.ok(!skills.includes(TEAM_DISPATCH_ONLY_SKILL));
});

test('explicit Brain brochure intent upgrades knowledge and preserves brain.query', () => {
  const knowledgeMode = resolveDispatchKnowledgeMode({
    objective: 'Send each Bangalore lead the brochure from Brain on WhatsApp',
    task: 'Send a greeting, brochure, and poll to the validated leads',
    proposed: 'reference_only',
  });
  assert.equal(knowledgeMode, 'required');
  const allowed = resolveDispatchAllowedScopes({
    role: 'outreach',
    task: 'Send a WhatsApp greeting, brochure, and poll',
    delegatedScopes: ['whatsapp.contact_send', 'brain.query', 'crm.write'],
    knowledgeMode,
    requested: ['whatsapp.contact_send'],
  });
  assert.deepEqual(allowed, ['whatsapp.contact_send', 'brain.query']);
});

test('host binds every intent requirement and restores required Brain scope', () => {
  const dispatches = bindIntentRequirements(
    [
      {
        dispatchId: 'd1',
        agentId: 'filter',
        agentName: 'Lead Filter',
        role: 'filtering',
        task: 'Filter the provided records',
        delegatedScopes: [],
        allowedScopes: [],
        stageOrder: 1,
        inputRefs: ['team-input:sheet'],
        allowedSources: ['authoritative_input'],
        knowledgeMode: 'none',
        outputContract: DEFAULT_RESULT_CONTRACT,
        requirementIds: [],
      },
      {
        dispatchId: 'd2',
        agentId: 'messenger',
        agentName: 'WhatsApp Messenger',
        role: 'messaging',
        task: 'Send WhatsApp outreach',
        delegatedScopes: ['whatsapp.contact_send', 'brain.query'],
        allowedScopes: ['whatsapp.contact_send'],
        stageOrder: 2,
        inputRefs: [],
        allowedSources: ['authoritative_input'],
        knowledgeMode: 'none',
        outputContract: DEFAULT_RESULT_CONTRACT,
        requirementIds: [],
      },
    ],
    [
      { id: 'filter-city', text: 'Retain only Bangalore leads', source: 'original' },
      { id: 'brain-brochure', text: 'Send the brochure from Brain on WhatsApp', source: 'original' },
    ],
    'Retain only Bangalore leads, then send the brochure from Brain on WhatsApp',
  );
  assert.deepEqual(dispatches.flatMap((item) => item.requirementIds).sort(), [
    'brain-brochure',
    'filter-city',
  ]);
  assert.match(dispatches[0]!.task, /filter-city/);
  assert.match(dispatches[1]!.task, /brain-brochure/);
  assert.equal(dispatches[1]!.knowledgeMode, 'required');
  assert.ok(dispatches[1]!.allowedScopes.includes('brain.query'));
});

test('question and cancel follow-ups cannot receive external-action scopes', () => {
  const base = {
    dispatchId: 'd1',
    agentId: 'messenger',
    agentName: 'WhatsApp Messenger',
    role: 'messaging',
    task: 'Answer the follow-up',
    delegatedScopes: ['whatsapp.contact_send', 'brain.query'],
    allowedScopes: ['whatsapp.contact_send', 'brain.query'],
    stageOrder: 1,
    inputRefs: [],
    allowedSources: ['authoritative_input'] as const,
    knowledgeMode: 'required' as const,
    outputContract: DEFAULT_RESULT_CONTRACT,
    requirementIds: [],
  };
  for (const mode of ['question', 'cancel'] as const) {
    const [dispatch] = bindIntentRequirements(
      [{ ...base, allowedSources: [...base.allowedSources] }],
      [{ id: 'follow-up', text: 'Answer without taking action', source: 'follow_up' }],
      'Answer without taking action',
      mode,
    );
    assert.deepEqual(dispatch!.allowedScopes, []);
    assert.equal(dispatch!.knowledgeMode, 'none');
  }
});

test('downstream stage may cite prior Result lineage without a new file', () => {
  const prior = {
    summary: 'One lead',
    findings: { leads: [{ Name: 'Aarav Sharma', Phone: '+918095404788', City: 'Bangalore' }] },
    provenance: {
      inputRefs: ['team-input:sheet'],
      recordRefs: ['team-input:sheet:row:2'],
      knowledgeRefs: [],
    },
  };
  const result = validateLunaTeamsResult({
    run: incidentRun,
    dispatch: { ...filterDispatch, inputRefs: [] },
    priorHandbacks: [prior],
    payload: {
      summary: 'Saved contact',
      findings: {
        contacts: [{ Name: 'Aarav Sharma', Phone: '+918095404788', City: 'Bangalore' }],
      },
      provenance: {
        inputRefs: ['team-input:sheet'],
        recordRefs: ['team-input:sheet:row:2'],
        knowledgeRefs: [],
      },
    },
  });
  assert.equal(result.provenance.recordRefs[0], 'team-input:sheet:row:2');
});

test('invented source refs fail clearly when the dispatch has no file', () => {
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: { ...incidentRun, inputs: [] },
        dispatch: { ...filterDispatch, inputRefs: [] },
        payload: {
          summary: 'Leads',
          findings: { leads: [] },
          provenance: {
            inputRefs: ['team-input:lead-filtering'],
            recordRefs: [],
            knowledgeRefs: [],
          },
        },
      }),
    /no attached input/,
  );
});

test('empty commander outputContract still uses the default Result schema', () => {
  assert.equal(effectiveOutputContract({}).type, 'object');
  assert.deepEqual(effectiveOutputContract(undefined).required, DEFAULT_RESULT_CONTRACT.required);
});

test('tool-sourced assessment Results use evidence provenance without row lineage', () => {
  const result = validateLunaTeamsResult({
    run: { ...incidentRun, inputs: [] },
    dispatch: {
      inputRefs: [],
      allowedSources: ['authoritative_input'],
      knowledgeMode: 'none',
      outputContract: TOOL_EVIDENCE_RESULT_CONTRACT,
      resultPolicy: 'tool_evidence.v1',
    },
    payload: {
      summary: 'Assessment finding recorded',
      findings: [{ criterionId: 'tests', verdict: 'met', evidence_refs: ['evidence-1'] }],
      provenance: {
        toolRefs: ['assessment_evidence_search', 'assessment_evidence_read'],
        evidenceRefs: ['evidence-1'],
        artifactRefs: [],
      },
    },
    executedToolRefs: ['assessment_evidence_search', 'assessment_evidence_read'],
  });
  assert.deepEqual(result.provenance.evidenceRefs, ['evidence-1']);
  assert.deepEqual(result.provenance.recordRefs, []);
});

test('tool-sourced assessment Results cannot pass without evidence or artifacts', () => {
  assert.throws(
    () => validateLunaTeamsResult({
      run: { ...incidentRun, inputs: [] },
      dispatch: {
        inputRefs: [],
        allowedSources: ['authoritative_input'],
        knowledgeMode: 'none',
        outputContract: TOOL_EVIDENCE_RESULT_CONTRACT,
        resultPolicy: 'tool_evidence.v1',
      },
      payload: {
        summary: 'Unsupported assessment',
        findings: [],
        provenance: { toolRefs: [], evidenceRefs: [], artifactRefs: [] },
      },
    }),
    /requires evidenceRefs or artifactRefs/,
  );
});

test('accepts a local sheet number when the worker adds a country code', () => {
  const result = validateLunaTeamsResult({
    run: {
      ...incidentRun,
      inputs: [
        {
          ...incidentRun.inputs[0]!,
          extractedText:
            'Name,Phone Number,City\nAarav Sharma,8095404788,Bangalore\nRohan Mehta,8105199337,chennai',
        },
      ],
    },
    dispatch: filterDispatch,
    payload: {
      summary: 'One Bangalore lead',
      findings: {
        leads: [{ name: 'Aarav Sharma', phone: '+918095404788', city: 'Bangalore' }],
      },
      provenance: {
        inputRefs: ['team-input:sheet'],
        recordRefs: ['team-input:sheet:row:2'],
        knowledgeRefs: [],
      },
    },
  });
  assert.equal(result.provenance.recordRefs[0], 'team-input:sheet:row:2');
});

test('incident regression rejects brochure and stale-memory contacts as operational data', () => {
  for (const [name, phone] of [
    ['Brochure contact', '9442592170'],
    ['Bhuveneshwari', '919888888888'],
  ]) {
    assert.throws(
      () =>
        validateLunaTeamsResult({
          run: incidentRun,
          dispatch: filterDispatch,
          payload: {
            summary: 'Lead',
            findings: { leads: [{ name, phone, city: 'Bangalore' }] },
            provenance: {
              inputRefs: ['team-input:sheet'],
              recordRefs: ['team-input:sheet:row:2'],
              knowledgeRefs: [],
            },
          },
        }),
      /absent from authoritative input/,
    );
  }
});
