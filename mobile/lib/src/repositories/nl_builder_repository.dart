import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../models/nl_builder.dart';

const _stepUpHeader = 'X-QLIX-Device-Step-Up';

class NlBuilderRepository {
  NlBuilderRepository({required this.client});
  final ApiClient client;

  // ── Step-up token (mobile bypass for WebAuthn) ────────────────────────────

  Future<String?> getMobileStepUpToken() async {
    try {
      final res = await client.dio.post<dynamic>('/mobile/step-up');
      final data = res.data;
      if (res.statusCode == 200 && data is Map) {
        return data['stepUpToken'] as String?;
      }
    } catch (_) {}
    return null;
  }

  // ── NL parse ──────────────────────────────────────────────────────────────

  Future<({bool ok, AgentCreationPlan? plan, String? error})> nlParse(
      String prompt, String model) async {
    try {
      final res = await client.dio.post<dynamic>(
        '/agents/nl-parse',
        data: {'prompt': prompt, 'model': model},
      );
      final data = res.data;
      if (res.statusCode == 200 && data is Map && data['plan'] != null) {
        final plan = AgentCreationPlan.fromJson(
            data['plan'] as Map<String, dynamic>);
        return (ok: true, plan: plan, error: null);
      }
      final msg = apiErrorMessage(data, 'Parse failed (${res.statusCode})');
      return (ok: false, plan: null, error: msg);
    } catch (e) {
      return (ok: false, plan: null, error: 'Network error — check your connection');
    }
  }

  // ── Create single agent ───────────────────────────────────────────────────

  Future<({bool ok, CreatedAgentInfo? agent, String? error})> createAgent({
    required NLAgentSpec spec,
    required String stepUpToken,
    String? orgId,
  }) async {
    try {
      final body = {
        'name': spec.name,
        'description': spec.description.isEmpty ? null : spec.description,
        'permissionScopes': spec.permissionScopes,
        'jitScopes': spec.jitScopes,
        'runtime': spec.runtime,
        'model': spec.model,
        'llmMode': spec.llmMode,
        'localInferenceMode': spec.localInferenceMode,
        'orgId': orgId,
      };
      final res = await client.dio.post<dynamic>(
        '/agents',
        data: body,
        options: Options(headers: {_stepUpHeader: stepUpToken}),
      );
      final data = res.data;
      if ((res.statusCode == 200 || res.statusCode == 201) &&
          data is Map &&
          data['agent'] != null) {
        final info = CreatedAgentInfo.fromAgentJson(
            data['agent'] as Map<String, dynamic>);
        return (ok: true, agent: info, error: null);
      }
      return (
        ok: false,
        agent: null,
        error: apiErrorMessage(data, 'Failed to create agent (${res.statusCode})'),
      );
    } catch (e) {
      return (ok: false, agent: null, error: 'Network error creating agent');
    }
  }

  // ── Create team ───────────────────────────────────────────────────────────

  Future<({bool ok, String? teamId, String? error})> createTeam({
    required String name,
    required String description,
    required NLTeamConfig config,
    required String stepUpToken,
    String? orgId,
  }) async {
    try {
      final res = await client.dio.post<dynamic>(
        '/teams',
        data: {
          'name': name,
          'description': description,
          'config': config.toJson(),
          'orgId': orgId,
        },
        options: Options(headers: {_stepUpHeader: stepUpToken}),
      );
      final data = res.data;
      if ((res.statusCode == 200 || res.statusCode == 201) &&
          data is Map) {
        final team = data['team'] as Map?;
        final id = (team?['id'] ?? data['id']) as String?;
        if (id != null) return (ok: true, teamId: id, error: null);
      }
      return (
        ok: false,
        teamId: null,
        error: apiErrorMessage(data, 'Failed to create team (${res.statusCode})'),
      );
    } catch (e) {
      return (ok: false, teamId: null, error: 'Network error creating team');
    }
  }

  Future<String?> setSupervisor(String teamId, String agentId) async {
    try {
      final res = await client.dio.patch<dynamic>(
        '/teams/$teamId/supervisor',
        data: {'agentId': agentId},
      );
      if (res.statusCode == 200 || res.statusCode == 204) {
        return null;
      }
      return apiErrorMessage(res.data, 'Failed to set supervisor');
    } catch (_) {
      return 'Network error setting supervisor';
    }
  }

  Future<String?> addTeamMember({
    required String teamId,
    required String agentId,
    required String role,
    required List<String> delegatedScopes,
  }) async {
    try {
      final res = await client.dio.post<dynamic>(
        '/teams/$teamId/members',
        data: {
          'agentId': agentId,
          'role': role,
          'delegatedScopes': delegatedScopes,
        },
      );
      if (res.statusCode == 200 ||
          res.statusCode == 201 ||
          res.statusCode == 204) return null;
      return apiErrorMessage(res.data, 'Failed to add team member');
    } catch (_) {
      return 'Network error adding team member';
    }
  }

  // ── Build history ─────────────────────────────────────────────────────────

  Future<List<String>> fetchHistory() async {
    try {
      final res =
          await client.dio.get<dynamic>('/nl-builder/history');
      final data = res.data;
      if (res.statusCode == 200 && data is Map && data['entries'] is List) {
        return (data['entries'] as List)
            .whereType<Map<String, dynamic>>()
            .map((e) => BuilderHistoryEntry.fromJson(e).prompt)
            .toList();
      }
    } catch (_) {}
    return [];
  }

  Future<void> saveHistory(String prompt) async {
    try {
      await client.dio.post<dynamic>(
        '/nl-builder/history',
        data: {'prompt': prompt},
      );
    } catch (_) {}
  }
}
