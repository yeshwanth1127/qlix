import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/agent.dart';
import '../chat/chat_screen.dart';
import 'agents_providers.dart';

class AgentDetailScreen extends ConsumerWidget {
  const AgentDetailScreen({super.key, required this.agentId, this.agentName});

  final String agentId;
  final String? agentName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailAsync = ref.watch(agentDetailProvider(agentId));
    return Scaffold(
      appBar: AppBar(title: Text(agentName ?? 'Agent')),
      body: detailAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('$err', textAlign: TextAlign.center),
          ),
        ),
        data: (detail) => _DetailBody(detail: detail),
      ),
      floatingActionButton: detailAsync.maybeWhen(
        data: (detail) => FloatingActionButton.extended(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) =>
                  ChatScreen(agentId: detail.agent.id, agentName: detail.agent.name),
            ),
          ),
          icon: const Icon(Icons.chat_bubble_outline),
          label: const Text('Open chat'),
        ),
        orElse: () => null,
      ),
    );
  }
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({required this.detail});
  final AgentDetail detail;

  @override
  Widget build(BuildContext context) {
    final a = detail.agent;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
      children: [
        Text(a.name, style: Theme.of(context).textTheme.headlineSmall),
        if ((a.description ?? '').isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            a.description!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
        const SizedBox(height: 20),
        _InfoRow(label: 'Runtime', value: a.runtime),
        _InfoRow(label: 'Status', value: a.status.isEmpty ? '—' : a.status),
        _InfoRow(label: 'Model', value: a.model.isEmpty ? '—' : a.model),
        if (a.agentKind != null) _InfoRow(label: 'Kind', value: a.agentKind!),
        const SizedBox(height: 24),
        _SectionTitle('Permissions'),
        const SizedBox(height: 8),
        if (a.permissionScopes.isEmpty)
          Text(
            'No scopes granted.',
            style: Theme.of(context).textTheme.bodyMedium,
          )
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: a.permissionScopes
                .map((s) => Chip(label: Text(s)))
                .toList(),
          ),
        const SizedBox(height: 24),
        _SectionTitle('Credentials'),
        const SizedBox(height: 8),
        if (detail.credentials.isEmpty)
          Text(
            'No verifiable credentials.',
            style: Theme.of(context).textTheme.bodyMedium,
          )
        else
          ...detail.credentials.map(
            (c) => Card(
              child: ListTile(
                leading: const Icon(Icons.verified_outlined),
                title: Text(c.type),
                subtitle: Text(
                  c.expiresAt != null ? 'Expires ${c.expiresAt}' : 'No expiry',
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: Theme.of(context)
          .textTheme
          .titleMedium
          ?.copyWith(fontWeight: FontWeight.w700),
    );
  }
}
