import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/nl_builder.dart';
import '../../repositories/nl_builder_repository.dart';

// ─── State ────────────────────────────────────────────────────────────────────

enum BuilderFlowState { idle, parsing, planPreview, verifying, creating, done }

class BuilderState {
  const BuilderState({
    this.flowState = BuilderFlowState.idle,
    this.parseModel = 'openrouter/anthropic/claude-sonnet-4.6',
    this.agentModel = 'openrouter/anthropic/claude-sonnet-4.6',
    this.plan,
    this.parseError,
    this.verifyError,
    this.steps = const [],
    this.createdAgents = const [],
    this.teamId,
    this.history = const [],
  });

  final BuilderFlowState flowState;
  final String parseModel;
  final String agentModel;
  final AgentCreationPlan? plan;
  final String? parseError;
  final String? verifyError;
  final List<CreationStep> steps;
  final List<CreatedAgentInfo> createdAgents;
  final String? teamId;
  final List<String> history;

  BuilderState copyWith({
    BuilderFlowState? flowState,
    String? parseModel,
    String? agentModel,
    AgentCreationPlan? plan,
    Object? parseError = _sentinel,
    Object? verifyError = _sentinel,
    List<CreationStep>? steps,
    List<CreatedAgentInfo>? createdAgents,
    Object? teamId = _sentinel,
    List<String>? history,
  }) =>
      BuilderState(
        flowState: flowState ?? this.flowState,
        parseModel: parseModel ?? this.parseModel,
        agentModel: agentModel ?? this.agentModel,
        plan: plan ?? this.plan,
        parseError:
            parseError == _sentinel ? this.parseError : parseError as String?,
        verifyError:
            verifyError == _sentinel ? this.verifyError : verifyError as String?,
        steps: steps ?? this.steps,
        createdAgents: createdAgents ?? this.createdAgents,
        teamId: teamId == _sentinel ? this.teamId : teamId as String?,
        history: history ?? this.history,
      );
}

const _sentinel = Object();

// ─── Controller ───────────────────────────────────────────────────────────────

class BuilderController extends StateNotifier<BuilderState> {
  BuilderController(this._repo) : super(const BuilderState()) {
    _loadHistory();
  }

  final NlBuilderRepository _repo;

  Future<void> _loadHistory() async {
    final h = await _repo.fetchHistory();
    if (mounted) state = state.copyWith(history: h);
  }

  void setParseModel(String m) => state = state.copyWith(parseModel: m);
  void setAgentModel(String m) => state = state.copyWith(agentModel: m);
  void setPlan(AgentCreationPlan p) => state = state.copyWith(plan: p);

  Future<void> parse(String prompt) async {
    if (prompt.trim().isEmpty) return;
    state = state.copyWith(
      flowState: BuilderFlowState.parsing,
      parseError: null,
    );

    // Persist to history optimistically.
    final trimmed = prompt.trim();
    final updated = [trimmed, ...state.history.where((h) => h != trimmed)]
        .take(20)
        .toList();
    state = state.copyWith(history: updated);
    unawaited(_repo.saveHistory(trimmed));

    final result = await _repo.nlParse(trimmed, state.parseModel);
    if (!mounted) return;

    if (!result.ok || result.plan == null) {
      state = state.copyWith(
        flowState: BuilderFlowState.idle,
        parseError: result.error,
      );
      return;
    }

    // Stamp the selected agent model onto all specs in the plan.
    final plan = _applyAgentModel(result.plan!, state.agentModel);
    state = state.copyWith(
      flowState: BuilderFlowState.planPreview,
      plan: plan,
    );
  }

  AgentCreationPlan _applyAgentModel(AgentCreationPlan plan, String model) {
    return switch (plan) {
      SinglePlan p => SinglePlan(
          agent: p.agent..model = model,
          rationale: p.rationale,
        ),
      TeamPlan p => TeamPlan(
          team: p.team
            ..supervisor.model = model
            ..workers.forEach((w) => w.model = model),
          rationale: p.rationale,
        ),
    };
  }

  Future<void> createAgents(String? orgId) async {
    final plan = state.plan;
    if (plan == null) return;

    // Obtain mobile step-up token first.
    state = state.copyWith(flowState: BuilderFlowState.verifying);
    final stepUp = await _repo.getMobileStepUpToken();
    if (!mounted) return;
    if (stepUp == null) {
      state = state.copyWith(
        flowState: BuilderFlowState.planPreview,
        verifyError: 'Device verification failed — please try again',
      );
      return;
    }

    // Build step list.
    final steps = switch (plan) {
      SinglePlan p => [
          CreationStep(label: 'Creating ${p.agent.name}'),
        ],
      TeamPlan p => [
          CreationStep(
              label: 'Creating supervisor — ${p.team.supervisor.name}'),
          ...p.team.workers.map(
            (w) => CreationStep(label: 'Creating ${w.name}'),
          ),
          CreationStep(label: 'Assembling team — ${p.team.name}'),
        ],
    };

    state = state.copyWith(
      flowState: BuilderFlowState.creating,
      steps: steps,
      verifyError: null,
    );

    try {
      if (plan is SinglePlan) {
        await _createSingle(plan, stepUp, orgId);
      } else if (plan is TeamPlan) {
        await _createTeam(plan, stepUp, orgId);
      }
    } catch (e) {
      if (mounted) {
        state = state.copyWith(
          flowState: BuilderFlowState.planPreview,
          verifyError: e.toString(),
        );
      }
    }
  }

  Future<void> _createSingle(
      SinglePlan plan, String stepUp, String? orgId) async {
    _patchStep(0, status: CreationStepStatus.active);

    final result = await _repo.createAgent(
      spec: plan.agent,
      stepUpToken: stepUp,
      orgId: orgId,
    );
    if (!mounted) return;
    if (!result.ok || result.agent == null) {
      _patchStep(0,
          status: CreationStepStatus.error, errorMessage: result.error);
      throw Exception(result.error ?? 'Agent creation failed');
    }

    _patchStep(0, status: CreationStepStatus.done);
    state = state.copyWith(
      flowState: BuilderFlowState.done,
      createdAgents: [result.agent!],
    );
  }

  Future<void> _createTeam(
      TeamPlan plan, String stepUp, String? orgId) async {
    final created = <CreatedAgentInfo>[];

    // Supervisor
    _patchStep(0, status: CreationStepStatus.active);
    final supResult = await _repo.createAgent(
      spec: plan.team.supervisor,
      stepUpToken: stepUp,
      orgId: orgId,
    );
    if (!mounted) return;
    if (!supResult.ok || supResult.agent == null) {
      _patchStep(0,
          status: CreationStepStatus.error, errorMessage: supResult.error);
      throw Exception(supResult.error ?? 'Supervisor creation failed');
    }
    _patchStep(0, status: CreationStepStatus.done);
    created.add(supResult.agent!);

    // Workers
    final workerIds = <String>[];
    for (var i = 0; i < plan.team.workers.length; i++) {
      final worker = plan.team.workers[i];
      _patchStep(i + 1, status: CreationStepStatus.active);
      final wResult = await _repo.createAgent(
        spec: worker,
        stepUpToken: stepUp,
        orgId: orgId,
      );
      if (!mounted) return;
      if (!wResult.ok || wResult.agent == null) {
        _patchStep(i + 1,
            status: CreationStepStatus.error, errorMessage: wResult.error);
        throw Exception(wResult.error ?? 'Worker creation failed');
      }
      _patchStep(i + 1, status: CreationStepStatus.done);
      created.add(wResult.agent!);
      workerIds.add(wResult.agent!.id);
    }

    // Assemble team
    final assembleIdx = plan.team.workers.length + 1;
    _patchStep(assembleIdx, status: CreationStepStatus.active);

    final teamResult = await _repo.createTeam(
      name: plan.team.name,
      description: plan.team.description,
      config: plan.team.config,
      stepUpToken: stepUp,
      orgId: orgId,
    );
    if (!mounted) return;
    if (!teamResult.ok || teamResult.teamId == null) {
      _patchStep(assembleIdx,
          status: CreationStepStatus.error, errorMessage: teamResult.error);
      throw Exception(teamResult.error ?? 'Team creation failed');
    }

    final teamId = teamResult.teamId!;
    final supErr = await _repo.setSupervisor(teamId, supResult.agent!.id);
    if (supErr != null && mounted) throw Exception(supErr);

    for (var i = 0; i < plan.team.workers.length; i++) {
      final worker = plan.team.workers[i];
      _patchStep(assembleIdx, label: 'Adding ${worker.name} to team…');
      final addErr = await _repo.addTeamMember(
        teamId: teamId,
        agentId: workerIds[i],
        role: worker.role ?? 'worker',
        delegatedScopes: worker.permissionScopes,
      );
      if (addErr != null && mounted) throw Exception(addErr);
    }

    if (!mounted) return;
    _patchStep(assembleIdx,
        status: CreationStepStatus.done,
        label: 'Team assembled — ${plan.team.name}');
    state = state.copyWith(
      flowState: BuilderFlowState.done,
      createdAgents: created,
      teamId: teamId,
    );
  }

  void _patchStep(int index,
      {CreationStepStatus? status, String? label, String? errorMessage}) {
    final updated = List<CreationStep>.from(state.steps);
    if (index >= updated.length) return;
    final s = updated[index];
    if (status != null) s.status = status;
    if (label != null) s.label = label;
    if (errorMessage != null) s.errorMessage = errorMessage;
    state = state.copyWith(steps: updated);
  }

  void reset() {
    state = BuilderState(
      parseModel: state.parseModel,
      agentModel: state.agentModel,
      history: state.history,
    );
  }
}

// ignore: avoid_void_async
void unawaited(Future<void> f) {}
