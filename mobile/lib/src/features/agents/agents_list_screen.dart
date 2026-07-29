import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../theme.dart';
import '../../models/agent.dart';
import '../../ui/sketch.dart';
import 'agent_detail_screen.dart';
import 'agents_providers.dart';

class AgentsListScreen extends ConsumerWidget {
  const AgentsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(title: const Text('Agents')),
      body: const AgentsSectionBody(),
    );
  }
}

/// Agents list content without a Scaffold – used by [AppShell].
class AgentsSectionBody extends ConsumerWidget {
  const AgentsSectionBody({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agentsAsync = ref.watch(agentsListProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(agentsListProvider.future),
      child: agentsAsync.when(
        loading: () => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(14),
          children: const [
            SketchSkeleton(height: 72),
            SizedBox(height: 10),
            SketchSkeleton(height: 72),
            SizedBox(height: 10),
            SketchSkeleton(height: 72),
          ],
        ),
        error: (err, _) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            const SizedBox(height: 100),
            const Center(child: OrbitLoader()),
            const SizedBox(height: 16),
            Center(child: Text('$err', textAlign: TextAlign.center)),
            const SizedBox(height: 16),
            Center(
              child: OutlinedButton(
                onPressed: () => ref.invalidate(agentsListProvider),
                child: const Text('RETRY'),
              ),
            ),
          ],
        ),
        data: (agents) {
          if (agents.isEmpty) return const _EmptyState();
          return ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 28),
            itemCount: agents.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (context, i) => SectionIn(
              index: i.clamp(0, 8),
              child: _AgentCard(agent: agents[i]),
            ),
          );
        },
      ),
    );
  }
}

class _AgentCard extends StatelessWidget {
  const _AgentCard({required this.agent});
  final AgentDTO agent;

  @override
  Widget build(BuildContext context) {
    final online = agent.status.toLowerCase() == 'online' ||
        agent.status.toLowerCase() == 'active';

    return SketchCard(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) =>
              AgentDetailScreen(agentId: agent.id, agentName: agent.name),
        ),
      ),
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: QlixColors.accentSoft,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: QlixColors.accentBorder),
            ),
            child: const Icon(
              Icons.smart_toy_outlined,
              color: QlixColors.accent,
              size: 22,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  agent.name,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 15,
                    color: QlixColors.ink,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (online)
                      StatusPulse(color: QlixColors.green, size: 7)
                    else
                      Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: QlixColors.inkTertiary,
                          shape: BoxShape.circle,
                        ),
                      ),
                    _Pill(text: agent.runtime),
                    if (agent.status.isNotEmpty) _Pill(text: agent.status),
                  ],
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: QlixColors.inkTertiary),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: QlixColors.paperLo,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: QlixColors.inkBorder),
      ),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.8,
          color: QlixColors.inkSecondary,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: const [
        SizedBox(height: 100),
        Center(child: OrbitLoader(size: 64)),
        SizedBox(height: 20),
        Center(
          child: Text(
            'No agents yet',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: QlixColors.ink,
            ),
          ),
        ),
        SizedBox(height: 8),
        Center(
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 40),
            child: Text(
              'Create one with AI Builder to start chatting.',
              textAlign: TextAlign.center,
              style: TextStyle(color: QlixColors.inkSecondary, fontSize: 13),
            ),
          ),
        ),
      ],
    );
  }
}
