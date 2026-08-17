import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindIntentRequirements,
  parseLunaTeamsHandback,
  DEFAULT_RESULT_CONTRACT,
  effectiveOutputContract,
  isEmptyFindings,
  isRowStructuredInput,
  renderLunaTeamsFinal,
  renderResultHandbacks,
  resolveDispatchKnowledgeMode,
  resolveDispatchAllowedScopes,
  skillsForLunaTeamsDispatch,
  TEAM_DISPATCH_ONLY_SKILL,
  validateLunaTeamsResult,
} from './lunaTeamsHost.js';
import type { PermissionScope } from '../agents/agents.types.js';
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

test('renders only Result payloads as downstream context', () => {
  const context = renderResultHandbacks([
    { agentName: 'Filter', payload: { records: [{ id: 1 }] } },
  ]);
  assert.match(context, /authoritative/);
  assert.match(context, /"id":1/);
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
  allowedScopes: [] as PermissionScope[],
  requirementIds: [] as string[],
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

// --- Deck-run regression (team run cmsvejv8d0005ldjkurrelxtg) ---------------------------
// A stage reported `completed` with `findings: {}` after admitting it could not read the
// input. The pipeline continued and four downstream agents invented the missing content.

const deckRun = {
  id: 'run_deck',
  inputs: [
    {
      ref: 'team-input:deck',
      purpose: 'authoritative_input',
      fileName: 'pitch.pptx',
      extractedText: 'THE TEAM\nYeshwanth SH — Founder & Developer\nSunder Ganesan — Systems Architect',
    },
  ],
} as unknown as TeamRunDTO;

const deckIntakeDispatch = {
  inputRefs: ['team-input:deck'],
  allowedSources: ['authoritative_input'] as const,
  knowledgeMode: 'none' as const,
  outputContract: DEFAULT_RESULT_CONTRACT,
  allowedScopes: [] as PermissionScope[],
  requirementIds: ['req_1_validate-this'],
};

test('isEmptyFindings treats every "nothing here" shape as empty', () => {
  for (const empty of [undefined, null, {}, [], '', '   ']) {
    assert.equal(isEmptyFindings(empty), true, `${JSON.stringify(empty)} should be empty`);
  }
  for (const filled of [{ leads: [] }, [1], 'text', 0, false]) {
    assert.equal(isEmptyFindings(filled), false, `${JSON.stringify(filled)} should not be empty`);
  }
});

test('a stage owning a requirement cannot report success with empty findings', () => {
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: deckRun,
        dispatch: deckIntakeDispatch,
        payload: {
          // The exact handback from the failed run.
          summary: 'I was unable to validate the pitch deck as the necessary tool is not available.',
          findings: {},
          provenance: { inputRefs: [], recordRefs: [], knowledgeRefs: [] },
        },
      }),
    /no findings for the requirement this stage owns \(req_1_validate-this\)/,
  );
});

test('a stage owning no requirement may still hand back empty findings', () => {
  const result = validateLunaTeamsResult({
    run: deckRun,
    dispatch: { ...deckIntakeDispatch, requirementIds: [] },
    payload: {
      summary: 'Nothing to report',
      findings: {},
      provenance: { inputRefs: [], recordRefs: [], knowledgeRefs: [] },
    },
  });
  assert.deepEqual(result.provenance.recordRefs, []);
});

test('real findings from the same dispatch pass', () => {
  const result = validateLunaTeamsResult({
    run: deckRun,
    dispatch: deckIntakeDispatch,
    payload: {
      summary: 'Read the deck',
      findings: { team: 'Yeshwanth SH, Sunder Ganesan' },
      provenance: { inputRefs: ['team-input:deck'], recordRefs: [], knowledgeRefs: [] },
    },
  });
  assert.deepEqual(result.provenance.inputRefs, ['team-input:deck']);
});

test('a tool-less stage cannot invent people under an unlisted key', () => {
  // `founders` is not in the operational-record allowlist, so before this guard the
  // fabricated names were never checked against the source at all.
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: deckRun,
        dispatch: deckIntakeDispatch,
        payload: {
          summary: 'Founders verified',
          findings: {
            founders: [{ name: 'Brent Hoberman', verificationStatus: 'verified' }],
          },
          provenance: { inputRefs: ['team-input:deck'], recordRefs: ['team-input:deck:row:1'], knowledgeRefs: [] },
        },
      }),
    /Operational value "Brent Hoberman" is absent from authoritative input/,
  );
});

test('a tool-less stage may report people that are actually in the source', () => {
  const result = validateLunaTeamsResult({
    run: deckRun,
    dispatch: deckIntakeDispatch,
    payload: {
      summary: 'Founders read from the deck',
      findings: { founders: [{ name: 'Yeshwanth SH' }, { name: 'Sunder Ganesan' }] },
      provenance: { inputRefs: ['team-input:deck'], recordRefs: ['team-input:deck:row:1'], knowledgeRefs: [] },
    },
  });
  assert.equal(result.provenance.recordRefs[0], 'team-input:deck:row:1');
});

test('isRowStructuredInput separates sheets from documents', () => {
  for (const input of [
    { fileName: 'leads.csv', mimeType: 'text/csv' },
    { fileName: 'leads.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { fileName: 'leads.XLSX', mimeType: '' },
    { fileName: 'book.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' },
  ]) {
    assert.equal(isRowStructuredInput(input), true, input.fileName);
  }
  for (const input of [
    { fileName: 'pitch.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    { fileName: 'memo.pdf', mimeType: 'application/pdf' },
    { fileName: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ]) {
    assert.equal(isRowStructuredInput(input), false, input.fileName);
  }
});

test('a deck stage is not asked for row lineage it cannot have', () => {
  // The exact shape that aborted the Deck Intake pipeline: record-shaped arrays extracted
  // from a .pptx, with recordRefs empty because a slide deck has no addressable rows.
  const result = validateLunaTeamsResult({
    run: deckRun,
    dispatch: deckIntakeDispatch,
    payload: {
      summary: 'Extracted the deck',
      findings: {
        founders: [{ name: 'Yeshwanth SH', title: 'Founder & Developer' }],
        // Not an identity-shaped key, but still a record-shaped array — this is the kind of
        // extraction that used to demand row numbers from a slide.
        metrics: [{ metric: 'agent actions per company', value: '1000+', slide: 2 }],
      },
      provenance: { inputRefs: ['team-input:deck'], recordRefs: [], knowledgeRefs: [] },
    },
  });
  assert.deepEqual(result.provenance.recordRefs, []);
});

test('dropping the lineage requirement does not drop the fabrication check', () => {
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: deckRun,
        dispatch: deckIntakeDispatch,
        payload: {
          summary: 'Founders verified',
          findings: { founders: [{ name: 'Brent Hoberman' }] },
          provenance: { inputRefs: ['team-input:deck'], recordRefs: [], knowledgeRefs: [] },
        },
      }),
    /Operational value "Brent Hoberman" is absent from authoritative input/,
  );
});

test('a sheet stage still owes row lineage', () => {
  const sheetRun = {
    id: 'run_sheet',
    inputs: [
      {
        ref: 'team-input:sheet',
        purpose: 'authoritative_input',
        fileName: 'leads.csv',
        mimeType: 'text/csv',
        extractedText: 'name,city\nAsha Rao,Bangalore',
      },
    ],
  } as unknown as TeamRunDTO;
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: sheetRun,
        dispatch: { ...deckIntakeDispatch, inputRefs: ['team-input:sheet'] },
        payload: {
          summary: 'Filtered the sheet',
          findings: { leads: [{ name: 'Asha Rao', city: 'Bangalore' }] },
          provenance: { inputRefs: ['team-input:sheet'], recordRefs: [], knowledgeRefs: [] },
        },
      }),
    /Operational records require authoritative input and row lineage/,
  );
});

test('a value split across table markup is read, not treated as invention', () => {
  const tableRun = {
    id: 'run_table',
    inputs: [
      {
        ref: 'team-input:deck',
        purpose: 'authoritative_input',
        fileName: 'pitch.pptx',
        extractedText:
          '| **Capability** | **Qlix** | **MS Entra**<br>**Agent ID** | **Okta for**<br>**AI Agents** |',
      },
    ],
  } as unknown as TeamRunDTO;
  const result = validateLunaTeamsResult({
    run: tableRun,
    dispatch: deckIntakeDispatch,
    payload: {
      summary: 'Read the competitor table',
      findings: { competitorsNamed: [{ name: 'Okta for AI Agents' }, { name: 'MS Entra Agent ID' }] },
      provenance: { inputRefs: ['team-input:deck'], recordRefs: [], knowledgeRefs: [] },
    },
  });
  assert.deepEqual(result.provenance.inputRefs, ['team-input:deck']);
});

test('a research stage keeps the narrow allowlist so web findings are not rejected', () => {
  // With research scope the agent legitimately discovers names that are not in any input.
  const result = validateLunaTeamsResult({
    run: deckRun,
    dispatch: {
      ...deckIntakeDispatch,
      requirementIds: [],
      inputRefs: [],
      allowedScopes: ['web.research'] as PermissionScope[],
    },
    priorHandbacks: [
      {
        summary: 'prior',
        findings: { note: 'x' },
        provenance: { inputRefs: [], recordRefs: [], knowledgeRefs: [] },
      },
    ],
    payload: {
      summary: 'Researched founders',
      findings: { founders: [{ name: 'Someone Not In The Deck' }] },
      provenance: { inputRefs: [], recordRefs: [], knowledgeRefs: [] },
    },
  });
  assert.equal(result.provenance.recordRefs.length, 0);
});

// --- Contract-declared grounding (L1 + L2) ----------------------------------------------
// The contract says where each field must come from; no rule in code knows what a "founder" is.

const groundedContract = {
  type: 'object',
  required: ['summary', 'findings', 'provenance'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', grounding: 'input' },
              sourceUrl: { type: 'string', grounding: 'tool' },
              assessment: { type: 'string', grounding: 'derived' },
            },
          },
        },
      },
    },
    provenance: DEFAULT_RESULT_CONTRACT.properties!.provenance,
  },
} as Record<string, unknown>;

const researchDispatch = {
  inputRefs: ['team-input:deck'],
  allowedSources: ['authoritative_input'] as const,
  knowledgeMode: 'none' as const,
  outputContract: groundedContract,
  allowedScopes: ['web.research'] as PermissionScope[],
  requirementIds: [] as string[],
};

const researchPayload = (person: Record<string, unknown>) => ({
  summary: 'Founders',
  findings: { people: [person] },
  provenance: { inputRefs: ['team-input:deck'], recordRefs: [], knowledgeRefs: [] },
});

test('a research stage cannot introduce a subject that was never given to it', () => {
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: deckRun,
        dispatch: researchDispatch,
        toolUrls: new Set(['https://uk.linkedin.com/in/brenthoberman']),
        payload: researchPayload({
          name: 'Brent Hoberman',
          sourceUrl: 'https://uk.linkedin.com/in/brenthoberman',
        }),
      }),
    /Result is not grounded — findings\.people\[0\]\.name .* not in anything this dispatch was given/,
  );
});

test('a research stage may report new facts about a subject that was given', () => {
  const result = validateLunaTeamsResult({
    run: deckRun,
    dispatch: researchDispatch,
    toolUrls: new Set(['https://linkedin.com/in/yeshwanth']),
    payload: researchPayload({
      name: 'Yeshwanth SH',
      sourceUrl: 'https://linkedin.com/in/yeshwanth',
      assessment: 'Strong technical background — a judgement, grounded in nothing',
    }),
  });
  assert.deepEqual(result.provenance.inputRefs, ['team-input:deck']);
});

test('a citation no tool returned fails even when the subject is real', () => {
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: deckRun,
        dispatch: researchDispatch,
        toolUrls: new Set(['https://linkedin.com/in/yeshwanth']),
        payload: researchPayload({ name: 'Yeshwanth SH', sourceUrl: 'https://sohailprasad.com/' }),
      }),
    /was not returned by any tool in this dispatch/,
  );
});

test('a declared field is not also judged by the name-shaped heuristic', () => {
  // `name` would trip the identity heuristic on a tool-less dispatch; the contract owns it here
  // and says it may be discovered, so the dispatch is allowed to report it.
  const discoveryContract = JSON.parse(JSON.stringify(groundedContract)) as Record<string, unknown>;
  (discoveryContract as any).properties.findings.properties.people.items.properties.name.grounding =
    'derived';

  const result = validateLunaTeamsResult({
    run: deckRun,
    dispatch: { ...researchDispatch, allowedScopes: [], outputContract: discoveryContract },
    payload: {
      summary: 'Discovered',
      findings: { people: [{ name: 'Someone Not In The Deck' }] },
      provenance: { inputRefs: ['team-input:deck'], recordRefs: ['team-input:deck:row:1'], knowledgeRefs: [] },
    },
  });
  assert.equal(result.provenance.recordRefs[0], 'team-input:deck:row:1');
});

test('an unannotated contract behaves exactly as before', () => {
  // The lead pipeline declares nothing, so the existing heuristic still governs it.
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: incidentRun,
        dispatch: filterDispatch,
        payload: {
          summary: 'Lead',
          findings: { leads: [{ name: 'Nobody Real', phone: '+919999999999', city: 'Bangalore' }] },
          provenance: {
            inputRefs: ['team-input:sheet'],
            recordRefs: ['team-input:sheet:row:2'],
            knowledgeRefs: [],
          },
        },
      }),
    /Operational value "Nobody Real" is absent from authoritative input/,
  );
});

test('grounding never applies to the Result envelope itself', () => {
  // A planner that tags `summary` must not make every synthesised sentence a failure.
  const overTagged = {
    ...groundedContract,
    properties: {
      ...(groundedContract.properties as Record<string, unknown>),
      summary: { type: 'string', grounding: 'input' },
    },
  };
  const result = validateLunaTeamsResult({
    run: deckRun,
    dispatch: { ...researchDispatch, outputContract: overTagged },
    toolUrls: new Set<string>(),
    payload: {
      summary: 'A synthesised sentence appearing nowhere in the source',
      findings: { people: [] },
      provenance: { inputRefs: ['team-input:deck'], recordRefs: [], knowledgeRefs: [] },
    },
  });
  assert.deepEqual(result.provenance.inputRefs, ['team-input:deck']);
});

test('a messaging stage keeps the channel scope its member was delegated', () => {
  // The host writes this task itself when commander planning fails; it names no connector,
  // so the member's name is the only signal that this stage has to send something.
  const allowed = resolveDispatchAllowedScopes({
    role: 'messaging',
    task: 'Continue the objective using only the Result handbacks supplied by Luna-Teams. Perform the messaging part; do not repeat earlier work.',
    agentName: 'WhatsApp Messenger',
    delegatedScopes: ['whatsapp.contact_send'],
    knowledgeMode: 'none',
  });
  assert.deepEqual(allowed, ['whatsapp.contact_send']);
});

test('binding requirements never narrows a grant the dispatch was planned with', () => {
  const [filter, messenger] = bindIntentRequirements(
    [
      {
        dispatchId: 'd1',
        agentId: 'a1',
        agentName: 'Lead Filter',
        role: 'filtering',
        task: 'Filter the Bangalore leads',
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
        agentId: 'a2',
        agentName: 'WhatsApp Messenger',
        role: 'messaging',
        task: 'Continue from the handbacks; perform the messaging part.',
        delegatedScopes: ['whatsapp.contact_send'],
        allowedScopes: ['whatsapp.contact_send'],
        stageOrder: 2,
        inputRefs: [],
        allowedSources: ['authoritative_input'],
        knowledgeMode: 'none',
        outputContract: DEFAULT_RESULT_CONTRACT,
        requirementIds: [],
      },
    ],
    [{ id: 'req_1', text: 'find all leads from Bangalore', source: 'original' }],
    'find all leads from Bangalore and message them',
  );
  assert.deepEqual(filter!.allowedScopes, []);
  assert.deepEqual(messenger!.allowedScopes, ['whatsapp.contact_send']);
});

// The 03:41 run: the planner declared findings as { items: [...] } and the worker returned the
// list itself. Both leads were correct, both traced to the sheet, and the run was thrown away.
const plannedContract = {
  type: 'object',
  required: ['summary', 'findings', 'provenance'],
  properties: {
    findings: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            // The planner pasted example values where field schemas belong.
            properties: {
              subject: 'Bangalore leads',
              sourceUrl: 'file:Sample.xlsx',
              assessment: 'Identified leads from Bangalore.',
            },
          },
        },
      },
    },
  },
};

test('a findings list is reshaped into the container the contract declares', () => {
  const result = validateLunaTeamsResult({
    run: incidentRun,
    dispatch: { ...filterDispatch, outputContract: plannedContract },
    payload: {
      summary: 'The leads from Bangalore have been identified.',
      findings: [{ Name: 'Aarav', Phone: '+919111111111', City: 'Bangalore' }],
      provenance: {
        inputRefs: ['team-input:sheet'],
        recordRefs: ['team-input:sheet:row:2'],
        knowledgeRefs: [],
      },
    },
  });
  assert.deepEqual(result.data, {
    summary: 'The leads from Bangalore have been identified.',
    findings: { items: [{ Name: 'Aarav', Phone: '+919111111111', City: 'Bangalore' }] },
    provenance: { inputRefs: ['team-input:sheet'], recordRefs: ['team-input:sheet:row:2'], knowledgeRefs: [] },
  });
});

test('a contract wanting a list accepts the wrapped object the worker returned', () => {
  const result = validateLunaTeamsResult({
    run: incidentRun,
    dispatch: {
      ...filterDispatch,
      outputContract: { type: 'object', properties: { findings: { type: 'array' } } },
    },
    payload: {
      summary: 'One lead',
      findings: { leads: [{ name: 'Aarav', phone: '+919111111111', city: 'Bangalore' }] },
      provenance: { inputRefs: ['team-input:sheet'], recordRefs: ['team-input:sheet:row:2'], knowledgeRefs: [] },
    },
  });
  assert.deepEqual((result.data as { findings: unknown }).findings, [
    { name: 'Aarav', phone: '+919111111111', city: 'Bangalore' },
  ]);
});

test('the interior shape of findings is advisory, the envelope is not', () => {
  const dispatch = {
    ...filterDispatch,
    outputContract: {
      type: 'object',
      required: ['summary', 'findings', 'provenance'],
      properties: {
        findings: {
          type: 'object',
          required: ['items'],
          properties: { items: { type: 'array' }, tally: { type: 'string' } },
        },
      },
    },
  };
  // Wrong keys and wrong types inside findings do not fail a grounded answer…
  const result = validateLunaTeamsResult({
    run: incidentRun,
    dispatch,
    payload: {
      summary: 'One lead',
      findings: { leads: [{ name: 'Aarav', phone: '+919111111111', city: 'Bangalore' }], tally: 1 },
      provenance: { inputRefs: ['team-input:sheet'], recordRefs: ['team-input:sheet:row:2'], knowledgeRefs: [] },
    },
  });
  assert.ok(result.data);
  // …while a missing envelope key still stops the run.
  assert.throws(
    () =>
      validateLunaTeamsResult({
        run: incidentRun,
        dispatch,
        payload: {
          findings: { items: [{ name: 'Aarav', phone: '+919111111111', city: 'Bangalore' }] },
          provenance: { inputRefs: ['team-input:sheet'], recordRefs: ['team-input:sheet:row:2'], knowledgeRefs: [] },
        },
      }),
    /result\.summary is required/,
  );
});

test('example values pasted in place of field schemas declare no grounding rule', () => {
  const contract = effectiveOutputContract(plannedContract);
  const findings = (contract.properties as Record<string, Record<string, unknown>>).findings;
  const items = (findings.properties as Record<string, Record<string, unknown>>).items;
  const itemSchema = items.items as Record<string, unknown>;
  assert.deepEqual(itemSchema.properties, {});
});
