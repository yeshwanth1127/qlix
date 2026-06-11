// Data models mirroring backend `nlTypes.ts` and `agents-api.ts`.

const kCloudModels = [
  'openrouter/anthropic/claude-sonnet-4.6',
  'openrouter/openai/gpt-4o',
  'openrouter/openai/gpt-4o-mini',
  'openrouter/google/gemini-2.5-flash',
  'openrouter/qwen/qwen-2.5-72b-instruct',
];

const kExamplePrompts = [
  'A web researcher that reads pages and sends me daily WhatsApp summaries',
  'Build a team with a supervisor, a web researcher, and a writer that drafts reports',
  'An agent that monitors my inbox and replies to simple questions automatically',
  'A finance tracker that can spend up to \$50 and reports transactions',
];

// ─── Agent spec ───────────────────────────────────────────────────────────────

class NLAgentSpec {
  NLAgentSpec({
    required this.name,
    required this.description,
    required this.permissionScopes,
    required this.jitScopes,
    required this.runtime,
    required this.model,
    required this.llmMode,
    this.localInferenceMode,
    required this.rationale,
    this.role,
    this.stageOrder,
  });

  String name;
  String description;
  List<String> permissionScopes;
  List<String> jitScopes;
  String runtime; // 'cloud' | 'hybrid' | 'local'
  String model;
  String llmMode; // 'proxy' | 'direct'
  String? localInferenceMode;
  String rationale;
  String? role; // worker-only
  int? stageOrder; // worker-only

  factory NLAgentSpec.fromJson(Map<String, dynamic> json) => NLAgentSpec(
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
        permissionScopes:
            List<String>.from(json['permissionScopes'] as List? ?? []),
        jitScopes: List<String>.from(json['jitScopes'] as List? ?? []),
        runtime: json['runtime'] as String? ?? 'cloud',
        model: json['model'] as String? ?? '',
        llmMode: json['llmMode'] as String? ?? 'proxy',
        localInferenceMode: json['localInferenceMode'] as String?,
        rationale: json['rationale'] as String? ?? '',
        role: json['role'] as String?,
        stageOrder: (json['stageOrder'] as num?)?.toInt(),
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'description': description,
        'permissionScopes': permissionScopes,
        'jitScopes': jitScopes,
        'runtime': runtime,
        'model': model,
        'llmMode': llmMode,
        'localInferenceMode': localInferenceMode,
        if (role != null) 'role': role,
        if (stageOrder != null) 'stageOrder': stageOrder,
      };
}

// ─── Team spec ────────────────────────────────────────────────────────────────

class NLTeamConfig {
  const NLTeamConfig({
    required this.maxParallelWorkers,
    required this.subtaskTimeoutMs,
    required this.retryPolicy,
  });

  final int maxParallelWorkers;
  final int subtaskTimeoutMs;
  final String retryPolicy;

  factory NLTeamConfig.fromJson(Map<String, dynamic> json) => NLTeamConfig(
        maxParallelWorkers:
            (json['maxParallelWorkers'] as num?)?.toInt() ?? 4,
        subtaskTimeoutMs:
            (json['subtaskTimeoutMs'] as num?)?.toInt() ?? 180000,
        retryPolicy: json['retryPolicy'] as String? ?? 'once',
      );

  Map<String, dynamic> toJson() => {
        'maxParallelWorkers': maxParallelWorkers,
        'subtaskTimeoutMs': subtaskTimeoutMs,
        'retryPolicy': retryPolicy,
        'humanInLoopTriggers': [
          'web.transaction',
          'finance.spend_50',
          'finance.spend_100',
        ],
        'pipelineMode': true,
        'autoSequence': false,
      };
}

class NLTeamSpec {
  NLTeamSpec({
    required this.name,
    required this.description,
    required this.supervisor,
    required this.workers,
    required this.config,
  });

  String name;
  String description;
  NLAgentSpec supervisor;
  List<NLAgentSpec> workers;
  NLTeamConfig config;

  factory NLTeamSpec.fromJson(Map<String, dynamic> json) => NLTeamSpec(
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
        supervisor: NLAgentSpec.fromJson(
            json['supervisor'] as Map<String, dynamic>),
        workers: (json['workers'] as List? ?? [])
            .cast<Map<String, dynamic>>()
            .map(NLAgentSpec.fromJson)
            .toList(),
        config: json['config'] != null
            ? NLTeamConfig.fromJson(json['config'] as Map<String, dynamic>)
            : const NLTeamConfig(
                maxParallelWorkers: 4,
                subtaskTimeoutMs: 180000,
                retryPolicy: 'once'),
      );
}

// ─── Plan (sealed union) ──────────────────────────────────────────────────────

sealed class AgentCreationPlan {
  AgentCreationPlan(this.rationale);
  final String rationale;

  factory AgentCreationPlan.fromJson(Map<String, dynamic> json) {
    if (json['type'] == 'team') {
      return TeamPlan(
        team: NLTeamSpec.fromJson(json['team'] as Map<String, dynamic>),
        rationale: json['rationale'] as String? ?? '',
      );
    }
    return SinglePlan(
      agent: NLAgentSpec.fromJson(json['agent'] as Map<String, dynamic>),
      rationale: json['rationale'] as String? ?? '',
    );
  }
}

class SinglePlan extends AgentCreationPlan {
  SinglePlan({required this.agent, required String rationale})
      : super(rationale);
  final NLAgentSpec agent;
}

class TeamPlan extends AgentCreationPlan {
  TeamPlan({required this.team, required String rationale}) : super(rationale);
  final NLTeamSpec team;
}

// ─── Supporting types ─────────────────────────────────────────────────────────

class BuilderHistoryEntry {
  const BuilderHistoryEntry({required this.id, required this.prompt});
  final String id;
  final String prompt;

  factory BuilderHistoryEntry.fromJson(Map<String, dynamic> json) =>
      BuilderHistoryEntry(
        id: json['id'] as String,
        prompt: json['prompt'] as String,
      );
}

class CreatedAgentInfo {
  const CreatedAgentInfo({
    required this.id,
    required this.name,
    required this.did,
    required this.runtime,
    required this.alwaysScopeCount,
    required this.jitScopeCount,
  });

  final String id;
  final String name;
  final String did;
  final String runtime;
  final int alwaysScopeCount;
  final int jitScopeCount;

  factory CreatedAgentInfo.fromAgentJson(Map<String, dynamic> agent) =>
      CreatedAgentInfo(
        id: agent['id'] as String,
        name: agent['name'] as String,
        did: agent['did'] as String? ?? '',
        runtime: agent['runtime'] as String? ?? 'cloud',
        alwaysScopeCount:
            (agent['alwaysScopes'] as List?)?.length ?? 0,
        jitScopeCount:
            (agent['jitScopes'] as List?)?.length ?? 0,
      );
}

enum CreationStepStatus { pending, active, done, error }

class CreationStep {
  CreationStep({
    required this.label,
    this.status = CreationStepStatus.pending,
    this.errorMessage,
  });

  String label;
  CreationStepStatus status;
  String? errorMessage;
}
