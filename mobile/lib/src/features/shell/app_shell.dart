import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/session.dart';
import '../../theme.dart';
import '../../ui/sketch.dart';
import '../agents/agents_list_screen.dart';
import '../ai_builder/ai_builder_screen.dart';
import '../overview/overview_screen.dart';

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
  _Item(_Sec.aiBuilder, 'AI Builder', Icons.auto_awesome),
  _Item(_Sec.overview, 'Overview', Icons.dashboard_outlined),
  _Item(_Sec.agents, 'Agents', Icons.smart_toy_outlined),
  _Item(_Sec.activeRuns, 'Active runs', Icons.play_circle_outline),
  _Item(_Sec.teams, 'Teams', Icons.group_outlined),
  _Item(_Sec.aiBrain, 'exa (ai brain)', Icons.psychology_outlined),
  _Item(_Sec.knowledge, 'Knowledge', Icons.menu_book_outlined),
  _Item(_Sec.passports, 'Passports', Icons.fingerprint),
  _Item(_Sec.auditLog, 'Audit log', Icons.history),
  _Item(_Sec.connectors, 'Connectors', Icons.electrical_services_outlined),
  _Item(_Sec.skills, 'Skills', Icons.build_outlined),
  _Item(_Sec.credentials, 'Credentials', Icons.verified_user_outlined),
  _Item(_Sec.apiKeys, 'API keys', Icons.key_outlined),
  _Item(_Sec.wallet, 'Wallet', Icons.account_balance_wallet_outlined),
  _Item(_Sec.usage, 'Usage', Icons.bar_chart_outlined),
  _Item(_Sec.billing, 'Billing', Icons.credit_card_outlined),
  _Item(_Sec.members, 'Members', Icons.people_outlined),
  _Item(_Sec.settings, 'Settings', Icons.settings_outlined),
];

/// Mirrors web `PRIMARY_NAV_SUFFIXES` — shown in the bottom pill strip.
const _kPrimary = <_Sec>{
  _Sec.aiBuilder,
  _Sec.overview,
  _Sec.agents,
  _Sec.activeRuns,
  _Sec.teams,
  _Sec.aiBrain,
  _Sec.knowledge,
  _Sec.passports,
  _Sec.auditLog,
};

_Item _lookup(_Sec sec) => _kAll.firstWhere((i) => i.sec == sec);

List<_Item> _itemsFor(Session session) {
  const core = [
    _Sec.aiBuilder,
    _Sec.overview,
    _Sec.agents,
    _Sec.activeRuns,
    _Sec.teams,
    _Sec.aiBrain,
    _Sec.knowledge,
    _Sec.passports,
    _Sec.auditLog,
    _Sec.connectors,
    _Sec.skills,
    _Sec.credentials,
    _Sec.apiKeys,
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
  _Sec _current = _Sec.overview;
  bool _moreOpen = false;

  void _navigate(_Sec sec) {
    setState(() {
      _current = sec;
      _moreOpen = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider).session;
    final items = session != null ? _itemsFor(session) : _kAll;
    final primary = items.where((i) => _kPrimary.contains(i.sec)).toList();
    final more = items.where((i) => !_kPrimary.contains(i.sec)).toList();
    final active = items.firstWhere(
      (i) => i.sec == _current,
      orElse: () => items.first,
    );

    return SketchBackdrop(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        extendBody: true,
        appBar: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: _GlassTopBar(
            title: active.label,
            subtitle: session == null
                ? null
                : '${session.organization.name} · ${session.organization.workspaceKind}',
          ),
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.only(bottom: 64),
            child: AnimatedSwitcher(
              duration: QlixMotion.section,
              switchInCurve: QlixMotion.ease,
              switchOutCurve: Curves.easeIn,
              transitionBuilder: (child, anim) {
                final curved = CurvedAnimation(
                  parent: anim,
                  curve: QlixMotion.ease,
                );
                return FadeTransition(
                  opacity: curved,
                  child: SlideTransition(
                    position: Tween<Offset>(
                      begin: const Offset(0, 0.02),
                      end: Offset.zero,
                    ).animate(curved),
                    child: child,
                  ),
                );
              },
              child: KeyedSubtree(
                key: ValueKey(_current),
                child: _SectionBody(
                  section: _current,
                  label: active.label,
                  onOpenAgents: () => _navigate(_Sec.agents),
                  onOpenBuilder: () => _navigate(_Sec.aiBuilder),
                ),
              ),
            ),
          ),
        ),
        bottomNavigationBar: _BottomNav(
          primary: primary,
          more: more,
          current: _current,
          moreOpen: _moreOpen,
          showUpgrade: session != null && !session.isOrganization,
          onSelect: _navigate,
          onToggleMore: () => setState(() => _moreOpen = !_moreOpen),
          onSignOut: () =>
              ref.read(sessionControllerProvider.notifier).signOut(),
        ),
      ),
    );
  }
}

// ─── Glass top bar ────────────────────────────────────────────────────────────

class _GlassTopBar extends StatelessWidget implements PreferredSizeWidget {
  const _GlassTopBar({required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Size get preferredSize => const Size.fromHeight(52);

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          padding: EdgeInsets.only(top: top),
          decoration: BoxDecoration(
            color: QlixColors.white.withValues(alpha: 0.62),
            border: const Border(
              bottom: BorderSide(color: QlixColors.inkBorder),
            ),
          ),
          child: SizedBox(
            height: 52,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  const QlixMark(size: 28),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: QlixColors.ink,
                            letterSpacing: 0.1,
                          ),
                        ),
                        if (subtitle != null)
                          Text(
                            subtitle!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 11,
                              color: QlixColors.inkTertiary,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Bottom nav (web mobile chrome) ───────────────────────────────────────────

class _BottomNav extends StatelessWidget {
  const _BottomNav({
    required this.primary,
    required this.more,
    required this.current,
    required this.moreOpen,
    required this.showUpgrade,
    required this.onSelect,
    required this.onToggleMore,
    required this.onSignOut,
  });

  final List<_Item> primary;
  final List<_Item> more;
  final _Sec current;
  final bool moreOpen;
  final bool showUpgrade;
  final void Function(_Sec) onSelect;
  final VoidCallback onToggleMore;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    final tabs = moreOpen
        ? <Widget>[
            _NavPill(
              label: '← Back',
              active: false,
              onTap: onToggleMore,
            ),
            ...more.map(
              (i) => _NavPill(
                label: i.label,
                active: i.sec == current,
                onTap: () => onSelect(i.sec),
              ),
            ),
            if (showUpgrade)
              const _NavPill(label: 'Upgrade to org', active: false),
            _NavPill(label: 'Sign out', active: false, onTap: onSignOut),
          ]
        : <Widget>[
            ...primary.map(
              (i) => _NavPill(
                label: i.label,
                active: i.sec == current,
                onTap: () => onSelect(i.sec),
              ),
            ),
            _NavPill(
              label: 'More',
              active: false,
              onTap: onToggleMore,
            ),
          ];

    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: Container(
          padding: EdgeInsets.only(bottom: bottom),
          decoration: BoxDecoration(
            color: QlixColors.white.withValues(alpha: 0.82),
            border: const Border(
              top: BorderSide(color: QlixColors.inkBorder),
            ),
            boxShadow: [
              BoxShadow(
                color: QlixColors.ink.withValues(alpha: 0.08),
                blurRadius: 28,
                offset: const Offset(0, -10),
                spreadRadius: -18,
              ),
            ],
          ),
          child: SizedBox(
            height: 56,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              children: [
                for (var i = 0; i < tabs.length; i++) ...[
                  if (i > 0) const SizedBox(width: 4),
                  tabs[i],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavPill extends StatelessWidget {
  const _NavPill({
    required this.label,
    required this.active,
    this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SketchPress(
      onTap: onTap,
      child: AnimatedContainer(
        duration: QlixMotion.fast,
        curve: QlixMotion.ease,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: active ? QlixColors.accentSoft : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
            fontSize: 10,
            fontWeight: active ? FontWeight.w700 : FontWeight.w500,
            letterSpacing: 1.2,
            color: active ? QlixColors.accent : QlixColors.inkTertiary,
          ),
        ),
      ),
    );
  }
}

// ─── Section bodies ───────────────────────────────────────────────────────────

class _SectionBody extends StatelessWidget {
  const _SectionBody({
    required this.section,
    required this.label,
    this.onOpenAgents,
    this.onOpenBuilder,
  });

  final _Sec section;
  final String label;
  final VoidCallback? onOpenAgents;
  final VoidCallback? onOpenBuilder;

  @override
  Widget build(BuildContext context) {
    return switch (section) {
      _Sec.aiBuilder => const AIBuilderSection(),
      _Sec.overview => OverviewSectionBody(
          onOpenAgents: onOpenAgents,
          onOpenBuilder: onOpenBuilder,
        ),
      _Sec.agents => const AgentsSectionBody(),
      _ => _ComingSoon(label: label),
    };
  }
}

class _ComingSoon extends StatelessWidget {
  const _ComingSoon({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: SectionIn(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const OrbitLoader(size: 64),
              const SizedBox(height: 24),
              Text(
                label,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              const SketchLabel('Coming soon on mobile'),
            ],
          ),
        ),
      ),
    );
  }
}
