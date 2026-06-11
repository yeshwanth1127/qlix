import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/session.dart';
import '../agents/agents_list_screen.dart';
import '../ai_builder/ai_builder_screen.dart';

// ─── Navigation model ─────────────────────────────────────────────────────────

enum _Sec {
  aiBuilder,
  overview,
  agents,
  activeRuns,
  teams,
  aiBrain,
  knowledge,
  passports,
  auditLog,
  connectors,
  skills,
  credentials,
  apiKeys,
  wallet,
  usage,
  billing,
  members,
  settings,
}

class _Item {
  const _Item(this.sec, this.label, this.icon);
  final _Sec sec;
  final String label;
  final IconData icon;
}

const _kAll = <_Item>[
  _Item(_Sec.aiBuilder,   'AI Builder',   Icons.auto_fix_high),
  _Item(_Sec.overview,    'Overview',     Icons.dashboard_outlined),
  _Item(_Sec.agents,      'Agents',       Icons.smart_toy_outlined),
  _Item(_Sec.activeRuns,  'Active runs',  Icons.play_circle_outline),
  _Item(_Sec.teams,       'Teams',        Icons.group_outlined),
  _Item(_Sec.aiBrain,     'AI Brain',     Icons.psychology),
  _Item(_Sec.knowledge,   'Knowledge',    Icons.menu_book_outlined),
  _Item(_Sec.passports,   'Passports',    Icons.fingerprint),
  _Item(_Sec.auditLog,    'Audit log',    Icons.history),
  _Item(_Sec.connectors,  'Connectors',   Icons.electrical_services),
  _Item(_Sec.skills,      'Skills',       Icons.build_outlined),
  _Item(_Sec.credentials, 'Credentials',  Icons.verified_user),
  _Item(_Sec.apiKeys,     'API keys',     Icons.key),
  _Item(_Sec.wallet,      'Wallet',       Icons.account_balance_wallet),
  _Item(_Sec.usage,       'Usage',        Icons.bar_chart),
  _Item(_Sec.billing,     'Billing',      Icons.credit_card),
  _Item(_Sec.members,     'Members',      Icons.people_outlined),
  _Item(_Sec.settings,    'Settings',     Icons.settings_outlined),
];

_Item _lookup(_Sec sec) => _kAll.firstWhere((i) => i.sec == sec);

List<_Item> _itemsFor(Session session) {
  const core = [
    _Sec.aiBuilder, _Sec.overview, _Sec.agents, _Sec.activeRuns, _Sec.teams,
    _Sec.aiBrain, _Sec.knowledge, _Sec.passports, _Sec.auditLog,
    _Sec.connectors, _Sec.skills, _Sec.credentials, _Sec.apiKeys,
  ];
  return [
    ...core.map(_lookup),
    if (!session.isOrganization && !session.user.billingExempt)
      _lookup(_Sec.wallet),
    _lookup(_Sec.usage),
    if (session.isOrganization && !session.user.billingExempt)
      _lookup(_Sec.billing),
    if (session.isOrganization) _lookup(_Sec.members),
    _lookup(_Sec.settings),
  ];
}

// ─── Shell ────────────────────────────────────────────────────────────────────

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  _Sec _current = _Sec.aiBuilder;

  void _navigate(_Sec sec) {
    setState(() => _current = sec);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider).session;
    final items = session != null ? _itemsFor(session) : _kAll;
    final active = items.firstWhere(
      (i) => i.sec == _current,
      orElse: () => items.first,
    );

    return Scaffold(
      appBar: AppBar(
        title: Text(active.label),
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu),
            tooltip: 'Menu',
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
      ),
      drawer: _AppDrawer(
        session: session,
        items: items,
        current: _current,
        onTap: _navigate,
        onSignOut: () =>
            ref.read(sessionControllerProvider.notifier).signOut(),
      ),
      body: _SectionBody(section: _current, label: active.label),
    );
  }
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

class _AppDrawer extends StatelessWidget {
  const _AppDrawer({
    required this.session,
    required this.items,
    required this.current,
    required this.onTap,
    required this.onSignOut,
  });

  final Session? session;
  final List<_Item> items;
  final _Sec current;
  final void Function(_Sec) onTap;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Drawer(
      backgroundColor: const Color(0xFF0D0D1A),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _DrawerHeader(session: session),
            const Divider(height: 1, color: Color(0xFF1F1F2E)),
            Expanded(
              child: ListView.builder(
                padding:
                    const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
                itemCount: items.length,
                itemBuilder: (_, i) {
                  final item = items[i];
                  final sel = item.sec == current;
                  return ListTile(
                    leading: Icon(
                      item.icon,
                      size: 20,
                      color: sel ? cs.primary : cs.onSurfaceVariant,
                    ),
                    title: Text(
                      item.label,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight:
                            sel ? FontWeight.w600 : FontWeight.w400,
                        color: sel ? cs.primary : cs.onSurface,
                      ),
                    ),
                    selected: sel,
                    selectedTileColor: const Color(0xFF1A1A35),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    onTap: () => onTap(item.sec),
                    dense: true,
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 12),
                  );
                },
              ),
            ),
            const Divider(height: 1, color: Color(0xFF1F1F2E)),
            Padding(
              padding: const EdgeInsets.all(8),
              child: ListTile(
                leading: Icon(Icons.logout, size: 20, color: cs.error),
                title: Text(
                  'Sign out',
                  style: TextStyle(fontSize: 14, color: cs.error),
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                onTap: onSignOut,
                dense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DrawerHeader extends StatelessWidget {
  const _DrawerHeader({required this.session});
  final Session? session;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Qlix',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: cs.primary,
                ),
          ),
          if (session != null) ...[
            const SizedBox(height: 12),
            Text(
              session!.user.displayName ?? session!.user.email,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 14,
                color: Colors.white,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              '${session!.organization.name} · ${session!.organization.workspaceKind}',
              style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }
}

// ─── Section bodies ───────────────────────────────────────────────────────────

class _SectionBody extends StatelessWidget {
  const _SectionBody({required this.section, required this.label});
  final _Sec section;
  final String label;

  @override
  Widget build(BuildContext context) {
    return switch (section) {
      _Sec.aiBuilder => const AIBuilderSection(),
      _Sec.agents    => const AgentsSectionBody(),
      _              => _ComingSoon(label: label),
    };
  }
}

// ─── Coming soon placeholder ──────────────────────────────────────────────────

class _ComingSoon extends StatelessWidget {
  const _ComingSoon({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.construction_outlined,
                size: 56, color: cs.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(label, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              'Coming soon on mobile',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: cs.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
