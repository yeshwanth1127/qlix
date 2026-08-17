/** Declarative external-event wait configuration (teams, solo agents, future triggers). */

export type WaitTriggerKind = 'whatsapp_inbound';

export type WaitFulfillment = 'collect_until_timeout' | 'first_match';

export type LiveArtifactFormat = 'xlsx' | 'csv' | 'json' | 'pdf' | 'pptx' | 'md' | 'html';

export type ReplyInterestLabel = 'interested' | 'unclear' | 'not_interested';

export type ReplyInterestFilter = {
  classifier: 'reply_interest';
  /** Labels that earn a row. Resolved from the run goal; defaults to interested + unclear. */
  include: ReplyInterestLabel[];
};

export type WaitContactAck = 'fixed' | 'none' | 'auto_reply';

export type WaitDeliveryChannel = 'whatsapp';

export type WaitDeliveryWhen = 'on_resume' | 'on_each_included_reply';

export type WaitDeliveryPolicy = {
  channel: WaitDeliveryChannel;
  when: WaitDeliveryWhen;
};

/** Side effect executed while a wait is open (e.g. live sandbox file). */
export type WaitSideEffect = {
  id: string;
  kind: 'live_sandbox_artifact';
  /** When omitted, inferred from the run goal at wait start (xlsx, pdf, pptx, …). */
  format?: LiveArtifactFormat;
  /** Column headers for tabular formats. */
  columns?: string[];
  title?: string;
  dedupeBy?: 'contact_jid';
  filter?: ReplyInterestFilter;
  contactAck?: WaitContactAck;
  deliver?: WaitDeliveryPolicy;
};

export type WaitStep = {
  id: string;
  /** Pipeline stage that arms this wait when it completes. */
  afterStageOrder: number;
  trigger: {
    kind: WaitTriggerKind;
    fulfillment: WaitFulfillment;
  };
  sideEffects: WaitSideEffect[];
  resume: {
    injectAs: 'whatsapp_responses';
    /** False when resume side effects fully satisfy the workflow. */
    continuePipeline?: boolean;
  };
};

/** Immutable wait policy for one team run execution. */
export type WaitPolicySnapshot = {
  waitSteps: WaitStep[];
  activeWaitStepId: string;
};

export type LiveArtifactRow = Record<string, string | null>;

/** Runtime state for a live artifact bound to a wait side effect. */
export type LiveArtifactState = {
  id: string;
  sideEffectId: string;
  sandboxId: string;
  url: string;
  fileName: string;
  format: LiveArtifactFormat;
  columns: string[];
  rows: LiveArtifactRow[];
  rowCount: number;
  updatedAt: string;
};
