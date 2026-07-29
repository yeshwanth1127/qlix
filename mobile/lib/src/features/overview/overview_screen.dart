import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/dashboard.dart';
import '../../theme.dart';
import '../../ui/sketch.dart';
import '../agents/agent_detail_screen.dart';
import 'overview_providers.dart';

/// Overview / home — mirrors web individual & org dashboards.
class OverviewSectionBody extends ConsumerWidget {
  const OverviewSectionBody({
    super.key,
    this.onOpenAgents,
    this.onOpenBuilder,
  });

  final VoidCallback? onOpenAgents;
  final VoidCallback? onOpenBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(dashboardHomeProvider);

    return RefreshIndicator(
      onRefresh: () => ref.refresh(dashboardHomeProvider.future),
      child: async.when(
        loading: () => const _OverviewSkeleton(),
        error: (err, _) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 80),
            const Center(child: OrbitLoader()),
            const SizedBox(height: 20),
            Center(
              child: Text(
                '$err',
                textAlign: TextAlign.center,
                style: const TextStyle(color: QlixColors.inkSecondary),
              ),
            ),
            const SizedBox(height: 16),
            Center(
              child: OutlinedButton(
                onPressed: () => ref.invalidate(dashboardHomeProvider),
                child: const Text('RETRY'),
              ),
            ),
          ],
        ),
        data: (home) => _OverviewContent(
          home: home,
          onOpenAgents: onOpenAgents,
          onOpenBuilder: onOpenBuilder,
        ),
      ),
    );
  }
}

class _OverviewContent extends StatelessWidget {
  const _OverviewContent({
    required this.home,
    this.onOpenAgents,
    this.onOpenBuilder,
  });

  final DashboardHome home;
  final VoidCallback? onOpenAgents;
  final VoidCallback? onOpenBuilder;

  @override
  Widget build(BuildContext context) {
    final metrics = home.metrics;
    var i = 0;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      children: [
        SectionIn(
          index: i++,
          child: Text(
            home.workspaceKind == 'organization'
                ? 'Overview'
                : 'Overview — ${home.firstName}',
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        const SizedBox(height: 14),
        if (metrics is IndividualDashboardMetrics)
          SectionIn(
            index: i++,
            child: _IndividualMetrics(metrics: metrics),
          )
        else if (metrics is OrgDashboardMetrics)
          SectionIn(
            index: i++,
            child: _OrgMetrics(metrics: metrics),
          ),
        const SizedBox(height: 22),
        SectionIn(
          index: i++,
          child: SketchLabel(
            home.workspaceKind == 'organization'
                ? 'Agent registry'
                : 'My agents',
          ),
        ),
        const SizedBox(height: 10),
        if (home.agents.isEmpty)
          SectionIn(
            index: i++,
            child: _EmptyAgentsCard(
              onOpenBuilder: onOpenBuilder,
              onOpenAgents: onOpenAgents,
            ),
          )
        else
          ...home.agents.take(8).toList().asMap().entries.map((e) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SectionIn(
                index: i + e.key,
                child: _AgentRow(agent: e.value),
              ),
            );
          }),
        if (home.agents.isNotEmpty && onOpenAgents != null)
          SectionIn(
            index: i + home.agents.length.clamp(0, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: onOpenAgents,
                child: const Text('See all agents →'),
              ),
            ),
          ),
        const SizedBox(height: 18),
        SectionIn(
          index: i + 10,
          child: const SketchLabel('Recent audit log'),
        ),
        const SizedBox(height: 10),
        if (home.auditEvents.isEmpty)
          SectionIn(
            index: i + 11,
            child: const _EmptyAuditCard(),
          )
        else
          ...home.auditEvents.take(10).toList().asMap().entries.map((e) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SectionIn(
                index: i + 12 + e.key,
                child: _AuditRow(event: e.value),
              ),
            );
          }),
      ],
    );
  }
}

class _IndividualMetrics extends StatelessWidget {
  const _IndividualMetrics({required this.metrics});
  final IndividualDashboardMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final vs = metrics.actionsVsYesterdayPercent;
    final vsLabel = vs == null
        ? null
        : '${vs >= 0 ? '+' : ''}${vs.toStringAsFixed(0)}% vs yesterday';

    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: SketchMetric(
                value: '${metrics.activeAgents}',
                label: 'Active agents',
                detail: '${metrics.agentsOnline} online now',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: SketchMetric(
                value: '${metrics.actionsToday}',
                label: 'Actions today',
                detail: vsLabel,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SketchMetric(
          value: '${metrics.credentialsValid}',
          label: 'Credentials valid',
        ),
      ],
    );
  }
}

class _OrgMetrics extends StatelessWidget {
  const _OrgMetrics({required this.metrics});
  final OrgDashboardMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final wow = metrics.actionsWeekOverWeekPercent;
    final wowLabel = wow == null
        ? null
        : '${wow >= 0 ? '+' : ''}${wow.toStringAsFixed(0)}% vs last week';

    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: SketchMetric(
                value: '${metrics.registeredAgents}',
                label: 'Registered agents',
                detail: '${metrics.agentsActiveToday} active today',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: SketchMetric(
                value: '${metrics.actionsThisWeek}',
                label: 'Actions this week',
                detail: wowLabel,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SketchMetric(
          value: '${metrics.policyViolations}',
          label: 'Policy violations',
          detail: metrics.policyViolations == 0 ? 'Target: 0' : null,
        ),
      ],
    );
  }
}

class _AgentRow extends StatelessWidget {
  const _AgentRow({required this.agent});
  final DashboardAgentRow agent;

  Color get _statusColor {
    switch (agent.status) {
      case 'online':
        return QlixColors.green;
      case 'idle':
        return QlixColors.warning;
      default:
        return QlixColors.inkTertiary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return SketchCard(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => AgentDetailScreen(
            agentId: agent.id,
            agentName: agent.name,
          ),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          if (agent.status == 'online')
            StatusPulse(color: _statusColor, size: 8)
          else
            Container(
              width: 10,
              height: 10,
              margin: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: _statusColor,
                shape: BoxShape.circle,
              ),
            ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  agent.name,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                    color: QlixColors.ink,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  '${agent.status} · ${agent.actionsToday} actions today',
                  style: const TextStyle(
                    fontSize: 12,
                    color: QlixColors.inkTertiary,
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, size: 18, color: QlixColors.inkTertiary),
        ],
      ),
    );
  }
}

class _AuditRow extends StatelessWidget {
  const _AuditRow({required this.event});
  final DashboardAuditEvent event;

  Color? get _left {
    switch (event.result) {
      case 'Blocked':
        return QlixColors.warning;
      case 'Flagged':
        return QlixColors.red;
      default:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final flagged = event.result == 'Flagged';
    return Container(
      decoration: BoxDecoration(
        color: flagged ? QlixColors.redSoft : QlixColors.glass,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: QlixColors.inkBorder),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_left != null)
              Container(
                width: 3,
                decoration: BoxDecoration(
                  color: _left,
                  borderRadius: const BorderRadius.horizontal(
                    left: Radius.circular(14),
                  ),
                ),
              ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          event.timeUtc,
                          style: const TextStyle(
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: QlixColors.inkTertiary,
                          ),
                        ),
                        const Spacer(),
                        _TinyPill(text: event.action),
                        const SizedBox(width: 6),
                        _TinyPill(
                          text: event.result,
                          color: event.result == 'Blocked'
                              ? QlixColors.warning
                              : event.result == 'Flagged'
                                  ? QlixColors.red
                                  : null,
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      event.description,
                      style: const TextStyle(fontSize: 13, color: QlixColors.ink),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      event.agentName,
                      style: const TextStyle(
                        fontSize: 12,
                        color: QlixColors.inkSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TinyPill extends StatelessWidget {
  const _TinyPill({required this.text, this.color});
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color?.withValues(alpha: 0.12) ?? QlixColors.paperLo,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.8,
          color: color ?? QlixColors.inkTertiary,
        ),
      ),
    );
  }
}

class _EmptyAgentsCard extends StatelessWidget {
  const _EmptyAgentsCard({this.onOpenBuilder, this.onOpenAgents});
  final VoidCallback? onOpenBuilder;
  final VoidCallback? onOpenAgents;

  @override
  Widget build(BuildContext context) {
    return SketchCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            "You haven't registered any agents yet.",
            style: TextStyle(color: QlixColors.inkSecondary, fontSize: 13),
          ),
          const SizedBox(height: 14),
          SketchPrimaryButton(
            label: 'Register your first agent →',
            onPressed: onOpenBuilder ?? onOpenAgents,
          ),
        ],
      ),
    );
  }
}

class _EmptyAuditCard extends StatelessWidget {
  const _EmptyAuditCard();

  @override
  Widget build(BuildContext context) {
    return const SketchCard(
      padding: EdgeInsets.all(20),
      child: Text(
        'No events in this time range.',
        style: TextStyle(color: QlixColors.inkSecondary, fontSize: 13),
      ),
    );
  }
}

class _OverviewSkeleton extends StatelessWidget {
  const _OverviewSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(14),
      children: [
        const SketchSkeleton(height: 24, width: 180, radius: 8),
        const SizedBox(height: 14),
        const Row(
          children: [
            Expanded(child: SketchSkeleton(height: 120)),
            SizedBox(width: 10),
            Expanded(child: SketchSkeleton(height: 120)),
          ],
        ),
        const SizedBox(height: 10),
        const SketchSkeleton(height: 100),
        const SizedBox(height: 22),
        const SketchSkeleton(height: 14, width: 90, radius: 6),
        const SizedBox(height: 10),
        const SketchSkeleton(height: 56),
        const SizedBox(height: 8),
        const SketchSkeleton(height: 56),
        const SizedBox(height: 8),
        const SketchSkeleton(height: 56),
      ],
    );
  }
}
