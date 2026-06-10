import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/agent.dart';

/// Agents for the current session's workspace.
final agentsListProvider = FutureProvider<List<AgentDTO>>((ref) async {
  final session = ref.watch(sessionControllerProvider).session;
  final repo = ref.watch(agentsRepositoryProvider);
  final orgId = session?.organization.id;
  return repo.listAgents(orgId);
});

final agentDetailProvider =
    FutureProvider.family<AgentDetail, String>((ref, agentId) async {
  final repo = ref.watch(agentsRepositoryProvider);
  return repo.getAgent(agentId);
});
