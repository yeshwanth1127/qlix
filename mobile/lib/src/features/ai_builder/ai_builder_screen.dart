import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/nl_builder.dart';
import '../../models/session.dart';
import '../../theme.dart';
import '../../ui/sketch.dart';
import 'ai_builder_controller.dart';

// ─── Public section widget (no Scaffold) ─────────────────────────────────────

class AIBuilderSection extends ConsumerStatefulWidget {
  const AIBuilderSection({super.key});

  @override
  ConsumerState<AIBuilderSection> createState() => _AIBuilderSectionState();
}

class _AIBuilderSectionState extends ConsumerState<AIBuilderSection> {
  final _promptCtrl = TextEditingController();
  bool _historyOpen = false;

  @override
  void dispose() {
    _promptCtrl.dispose();
    super.dispose();
  }

  BuilderController get _ctrl =>
      ref.read(builderControllerProvider.notifier);

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(builderControllerProvider);
    final session = ref.watch(sessionControllerProvider).session;
    final orgId = (session?.isOrganization ?? false)
        ? session?.organization.id
        : null;

    return switch (state.flowState) {
      BuilderFlowState.done => _DoneView(
          state: state,
          onReset: _ctrl.reset,
        ),
      BuilderFlowState.creating => _CreatingView(steps: state.steps),
      BuilderFlowState.verifying => const _VerifyingView(),
      BuilderFlowState.planPreview => _PlanPreviewView(
          state: state,
          onBack: _ctrl.reset,
          onCreate: () => _ctrl.createAgents(orgId),
        ),
      BuilderFlowState.idle ||
      BuilderFlowState.parsing =>
        _InputView(
          promptCtrl: _promptCtrl,
          state: state,
          historyOpen: _historyOpen,
          onHistoryToggle: () =>
              setState(() => _historyOpen = !_historyOpen),
          onHistorySelect: (p) {
            _promptCtrl.text = p;
            setState(() => _historyOpen = false);
          },
          onExampleSelect: (p) => _promptCtrl.text = p,
          onParseModelChanged: _ctrl.setParseModel,
          onAgentModelChanged: _ctrl.setAgentModel,
          onBuild: () => _ctrl.parse(_promptCtrl.text),
        ),
    };
  }
}

// ─── Input / parsing view ─────────────────────────────────────────────────────

class _InputView extends StatelessWidget {
  const _InputView({
    required this.promptCtrl,
    required this.state,
    required this.historyOpen,
    required this.onHistoryToggle,
    required this.onHistorySelect,
    required this.onExampleSelect,
    required this.onParseModelChanged,
    required this.onAgentModelChanged,
    required this.onBuild,
  });

  final TextEditingController promptCtrl;
  final BuilderState state;
  final bool historyOpen;
  final VoidCallback onHistoryToggle;
  final ValueChanged<String> onHistorySelect;
  final ValueChanged<String> onExampleSelect;
  final ValueChanged<String> onParseModelChanged;
  final ValueChanged<String> onAgentModelChanged;
  final VoidCallback onBuild;

  bool get _parsing => state.flowState == BuilderFlowState.parsing;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Header ──────────────────────────────────────────────────────
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: QlixColors.ink,
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: [
                    BoxShadow(
                      color: QlixColors.accent.withValues(alpha: 0.35),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                      spreadRadius: -6,
                    ),
                  ],
                ),
                child: const Icon(Icons.auto_awesome,
                    color: QlixColors.accent, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'AI Agent Builder',
                      style: tt.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: QlixColors.ink,
                      ),
                    ),
                    Text(
                      "Describe what you want — we'll create the agents",
                      style: tt.bodySmall
                          ?.copyWith(color: QlixColors.inkSecondary),
                    ),
                  ],
                ),
              ),
              // History button
              _HistoryButton(
                count: state.history.length,
                open: historyOpen,
                onTap: onHistoryToggle,
              ),
            ],
          ),

          // ── History dropdown ─────────────────────────────────────────────
          if (historyOpen)
            _HistoryDropdown(
              entries: state.history,
              onSelect: onHistorySelect,
            ),

          const SizedBox(height: 20),

          // ── Prompt field ─────────────────────────────────────────────────
          TextField(
            controller: promptCtrl,
            minLines: 5,
            maxLines: 8,
            maxLength: 5000,
            enabled: !_parsing,
            buildCounter: (_, {required currentLength, required isFocused, maxLength}) =>
                Text(
              '$currentLength / ${maxLength ?? 5000}',
              style: tt.labelSmall?.copyWith(color: cs.onSurfaceVariant),
            ),
            decoration: const InputDecoration(
              hintText:
                  'e.g. Build me a research agent that reads websites and sends me WhatsApp summaries each morning…',
              hintMaxLines: 3,
            ),
          ),

          const SizedBox(height: 14),

          // ── Model pickers ─────────────────────────────────────────────────
          Row(
            children: [
              Expanded(
                child: _ModelPicker(
                  label: 'Builder model',
                  hint: 'Interprets your prompt',
                  value: state.parseModel,
                  enabled: !_parsing,
                  onChanged: onParseModelChanged,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ModelPicker(
                  label: 'Agent model',
                  hint: 'What agents will use',
                  value: state.agentModel,
                  enabled: !_parsing,
                  onChanged: onAgentModelChanged,
                ),
              ),
            ],
          ),

          // ── Parse error ───────────────────────────────────────────────────
          if (state.parseError != null) ...[
            const SizedBox(height: 12),
            _ErrorBanner(message: state.parseError!),
          ],

          const SizedBox(height: 16),

          // ── Example prompts ───────────────────────────────────────────────
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: kExamplePrompts
                .map(
                  (ex) => ActionChip(
                    label: Text(
                      ex.length > 48 ? '${ex.substring(0, 46)}…' : ex,
                      style: const TextStyle(fontSize: 11),
                    ),
                    onPressed: _parsing ? null : () => onExampleSelect(ex),
                    visualDensity: VisualDensity.compact,
                  ),
                )
                .toList(),
          ),

          const SizedBox(height: 20),

          // ── Build button ──────────────────────────────────────────────────
          SizedBox(
            width: double.infinity,
            child: _GradientButton(
              label: _parsing ? 'Reading your request…' : 'Build',
              loading: _parsing,
              onPressed: _parsing ? null : onBuild,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Plan preview view ────────────────────────────────────────────────────────

class _PlanPreviewView extends StatelessWidget {
  const _PlanPreviewView({
    required this.state,
    required this.onBack,
    required this.onCreate,
  });

  final BuilderState state;
  final VoidCallback onBack;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final plan = state.plan!;
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              Icon(
                plan is TeamPlan ? Icons.group_outlined : Icons.smart_toy_outlined,
                size: 18,
                color: cs.primary,
              ),
              const SizedBox(width: 8),
              Text(
                switch (plan) {
                  TeamPlan p =>
                    'Team plan — ${1 + p.team.workers.length} agents',
                  SinglePlan _ => 'Agent plan',
                },
                style: tt.titleSmall?.copyWith(fontWeight: FontWeight.w600),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back, size: 14),
                label: const Text('Refine prompt',
                    style: TextStyle(fontSize: 12)),
                style: TextButton.styleFrom(
                  foregroundColor: cs.onSurfaceVariant,
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Agent / team cards
          if (plan case SinglePlan p) ...[
            _AgentSpecCard(spec: p.agent),
          ] else if (plan case TeamPlan p) ...[
            _AgentSpecCard(spec: p.team.supervisor, badge: 'Supervisor'),
            const SizedBox(height: 10),
            ...p.team.workers.map(
              (w) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _AgentSpecCard(
                  spec: w,
                  badge: w.role ?? 'Worker',
                ),
              ),
            ),
          ],

          // Error
          if (state.verifyError != null) ...[
            const SizedBox(height: 12),
            _ErrorBanner(message: state.verifyError!),
          ],

          const SizedBox(height: 20),

          // Actions
          Row(
            children: [
              TextButton(
                onPressed: onBack,
                child: const Text('← Back'),
              ),
              const Spacer(),
              _GradientButton(
                label: plan is TeamPlan ? 'Create team →' : 'Create agent →',
                onPressed: onCreate,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AgentSpecCard extends StatelessWidget {
  const _AgentSpecCard({required this.spec, this.badge});
  final NLAgentSpec spec;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const QlixColors.glass,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const QlixColors.inkBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.smart_toy_outlined,
                  size: 16, color: cs.primary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  spec.name,
                  style: tt.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
              if (badge != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: cs.primaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    badge!,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: cs.onPrimaryContainer,
                    ),
                  ),
                ),
            ],
          ),
          if (spec.description.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              spec.description,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: tt.bodySmall
                  ?.copyWith(color: cs.onSurfaceVariant),
            ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              _InfoChip(spec.runtime),
              _InfoChip(spec.model.split('/').last),
              if (spec.permissionScopes.isNotEmpty)
                _InfoChip(
                    '${spec.permissionScopes.length} scope${spec.permissionScopes.length == 1 ? '' : 's'}'),
              if (spec.jitScopes.isNotEmpty)
                _InfoChip('${spec.jitScopes.length} JIT'),
            ],
          ),
          if (spec.rationale.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              spec.rationale,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: tt.labelSmall?.copyWith(
                color: cs.onSurfaceVariant,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip(this.label);
  final String label;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style: Theme.of(context).textTheme.labelSmall),
    );
  }
}

// ─── Verifying view ───────────────────────────────────────────────────────────

class _VerifyingView extends StatelessWidget {
  const _VerifyingView();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text('Verifying…'),
        ],
      ),
    );
  }
}

// ─── Creating view ────────────────────────────────────────────────────────────

class _CreatingView extends StatelessWidget {
  const _CreatingView({required this.steps});
  final List<CreationStep> steps;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text('Creating…',
            style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 20),
        ...steps.map((s) => Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _StepIcon(s.status),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(s.label,
                            style: tt.bodyMedium?.copyWith(
                              fontWeight:
                                  s.status == CreationStepStatus.active
                                      ? FontWeight.w600
                                      : FontWeight.w400,
                            )),
                        if (s.errorMessage != null)
                          Text(s.errorMessage!,
                              style: tt.labelSmall
                                  ?.copyWith(color: cs.error)),
                      ],
                    ),
                  ),
                ],
              ),
            )),
      ],
    );
  }
}

class _StepIcon extends StatelessWidget {
  const _StepIcon(this.status);
  final CreationStepStatus status;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return switch (status) {
      CreationStepStatus.pending => Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: cs.outlineVariant),
          ),
        ),
      CreationStepStatus.active => SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(
              strokeWidth: 2, color: cs.primary),
        ),
      CreationStepStatus.done => Icon(Icons.check_circle,
          size: 20, color: const QlixColors.green),
      CreationStepStatus.error =>
        Icon(Icons.cancel, size: 20, color: cs.error),
    };
  }
}

// ─── Done view ────────────────────────────────────────────────────────────────

class _DoneView extends StatelessWidget {
  const _DoneView({required this.state, required this.onReset});
  final BuilderState state;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // Success banner
        Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: const QlixColors.green.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check,
                  size: 18, color: QlixColors.green),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  state.teamId != null ? 'Team created' : 'Agent created',
                  style: tt.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
                if (state.teamId != null)
                  Text(
                    'Team ID: ${state.teamId!.substring(0, 8)}…',
                    style: tt.labelSmall
                        ?.copyWith(color: cs.onSurfaceVariant),
                  ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 16),

        // Agent cards
        ...state.createdAgents.map(
          (a) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _CreatedAgentCard(agent: a),
          ),
        ),

        const SizedBox(height: 12),

        // Actions
        Row(
          children: [
            TextButton(
              onPressed: onReset,
              child: Text('Build another →',
                  style: TextStyle(color: cs.primary)),
            ),
          ],
        ),
      ],
    );
  }
}

class _CreatedAgentCard extends StatelessWidget {
  const _CreatedAgentCard({required this.agent});
  final CreatedAgentInfo agent;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const QlixColors.glass,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const QlixColors.inkBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.smart_toy_outlined,
                  size: 14, color: cs.primary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(agent.name,
                    style: tt.labelLarge
                        ?.copyWith(fontWeight: FontWeight.w600)),
              ),
              Text(
                '${agent.did.substring(0, agent.did.length.clamp(0, 24))}…',
                style: tt.labelSmall
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _InfoChip(agent.runtime),
              const SizedBox(width: 6),
              _InfoChip('${agent.alwaysScopeCount} always-on'),
              const SizedBox(width: 6),
              _InfoChip('${agent.jitScopeCount} JIT'),
            ],
          ),
          if (agent.runtime == 'cloud') ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.check_circle_outline,
                    size: 12, color: QlixColors.green),
                const SizedBox(width: 4),
                Text(
                  'Provisioning on Qlix cloud…',
                  style: tt.labelSmall?.copyWith(
                      color: const QlixColors.green),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ─── Shared small widgets ─────────────────────────────────────────────────────

class _GradientButton extends StatelessWidget {
  const _GradientButton({
    required this.label,
    this.loading = false,
    this.onPressed,
  });

  final String label;
  final bool loading;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null;
    return GestureDetector(
      onTap: onPressed,
      child: AnimatedOpacity(
        opacity: disabled ? 0.5 : 1.0,
        duration: const Duration(milliseconds: 150),
        child: Container(
          height: 48,
          decoration: BoxDecoration(
            color: disabled
                ? QlixColors.ink.withValues(alpha: 0.35)
                : QlixColors.ink,
            borderRadius: BorderRadius.circular(999),
            boxShadow: disabled
                ? null
                : [
                    BoxShadow(
                      color: QlixColors.accent.withValues(alpha: 0.28),
                      blurRadius: 18,
                      offset: const Offset(0, 8),
                      spreadRadius: -8,
                    ),
                  ],
          ),
          alignment: Alignment.center,
          child: loading
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white),
                )
              : Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: 11,
                    letterSpacing: 1.4,
                  ),
                ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: cs.errorContainer.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: cs.error.withValues(alpha: 0.4)),
      ),
      child: Text(message,
          style: TextStyle(fontSize: 12, color: cs.onErrorContainer)),
    );
  }
}

class _ModelPicker extends StatelessWidget {
  const _ModelPicker({
    required this.label,
    required this.hint,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  final String label;
  final String hint;
  final String value;
  final ValueChanged<String> onChanged;
  final bool enabled;

  String _short(String id) => id.split('/').last;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: tt.labelSmall
                ?.copyWith(color: cs.onSurfaceVariant)),
        const SizedBox(height: 4),
        DropdownButtonFormField<String>(
          initialValue: value,
          isExpanded: true,
          decoration: InputDecoration(
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            isDense: true,
          ),
          items: kCloudModels
              .map((m) => DropdownMenuItem(
                    value: m,
                    child: Text(
                      _short(m),
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ))
              .toList(),
          onChanged: enabled ? (v) => onChanged(v ?? value) : null,
        ),
        const SizedBox(height: 2),
        Text(hint,
            style: tt.labelSmall
                ?.copyWith(color: cs.onSurfaceVariant, fontSize: 10)),
      ],
    );
  }
}

class _HistoryButton extends StatelessWidget {
  const _HistoryButton({
    required this.count,
    required this.open,
    required this.onTap,
  });

  final int count;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          border: Border.all(color: const QlixColors.inkBorder),
          borderRadius: BorderRadius.circular(8),
          color: const QlixColors.glass,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history, size: 14, color: cs.onSurfaceVariant),
            const SizedBox(width: 4),
            Text('History',
                style: TextStyle(
                    fontSize: 11, color: cs.onSurfaceVariant)),
            if (count > 0) ...[
              const SizedBox(width: 4),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: cs.primary.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$count',
                  style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      color: cs.primary),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _HistoryDropdown extends StatelessWidget {
  const _HistoryDropdown({required this.entries, required this.onSelect});
  final List<String> entries;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: BoxDecoration(
        color: const QlixColors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const QlixColors.inkBorder),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
            child: Row(
              children: [
                Text(
                  'Previous build requests',
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: cs.onSurface),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: QlixColors.inkBorder),
          Flexible(
            child: entries.isEmpty
                ? const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'No history yet',
                      style:
                          TextStyle(fontSize: 11, color: Colors.grey),
                    ),
                  )
                : ListView.builder(
                    shrinkWrap: true,
                    padding: const EdgeInsets.all(6),
                    itemCount: entries.length,
                    itemBuilder: (_, i) => InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () => onSelect(entries[i]),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 8),
                        child: Text(
                          entries[i],
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 11,
                              color: cs.onSurfaceVariant),
                        ),
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}
