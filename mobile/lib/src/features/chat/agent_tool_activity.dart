import '../../models/chat.dart';

/// Dart port of `frontend/src/components/qlix/agents/agentToolActivity.ts`.
///
/// Only activity tied to a real tool call (or a JIT approval) is surfaced;
/// lifecycle/plumbing events return null so the activity feed stays quiet until
/// the model actually does something.

class _ToolMeta {
  const _ToolMeta(this.label, this.category, [this.verb]);
  final String label;
  final ToolCategory category;
  final String? verb;
}

const Map<String, _ToolMeta> _toolMeta = {
  'browser_navigate': _ToolMeta('Browser', ToolCategory.browser, 'Navigate to page'),
  'browser_click': _ToolMeta('Browser', ToolCategory.browser, 'Click element'),
  'browser_type': _ToolMeta('Browser', ToolCategory.browser, 'Type into field'),
  'browser_screenshot': _ToolMeta('Browser', ToolCategory.browser, 'Take screenshot'),
  'browser_extract': _ToolMeta('Browser', ToolCategory.browser, 'Extract page content'),
  'browser_axtree': _ToolMeta('Browser', ToolCategory.browser, 'Read page structure'),
  'browser_ab_open': _ToolMeta('Browser', ToolCategory.browser, 'Open URL'),
  'browser_ab_snapshot': _ToolMeta('Browser', ToolCategory.browser, 'Page snapshot'),
  'browser_ab_click': _ToolMeta('Browser', ToolCategory.browser, 'Click'),
  'browser_ab_fill': _ToolMeta('Browser', ToolCategory.browser, 'Fill field'),
  'browser_ab_type': _ToolMeta('Browser', ToolCategory.browser, 'Type'),
  'browser_ab_screenshot': _ToolMeta('Browser', ToolCategory.browser, 'Screenshot'),
  'browser_ab_find': _ToolMeta('Browser', ToolCategory.browser, 'Find & act'),
  'browser_ab_get': _ToolMeta('Browser', ToolCategory.browser, 'Get page info'),
  'browser_exec': _ToolMeta('Browser', ToolCategory.browser, 'CLI command'),
  'whatsapp_send': _ToolMeta('WhatsApp', ToolCategory.other, 'Send file'),
  'brain_query': _ToolMeta('AI Brain', ToolCategory.brain, 'Query knowledge'),
  'brain_knowledge_read': _ToolMeta('AI Brain', ToolCategory.brain, 'Read knowledge'),
  'shell_exec': _ToolMeta('Shell', ToolCategory.system, 'Run command'),
  'code_interpreter': _ToolMeta('Code', ToolCategory.system, 'Run code'),
  's3_read_file': _ToolMeta('Agent-S3', ToolCategory.agents3, 'Read file'),
  's3_write_file': _ToolMeta('Agent-S3', ToolCategory.agents3, 'Write file'),
  's3_list_dir': _ToolMeta('Agent-S3', ToolCategory.agents3, 'List directory'),
  's3_open_file': _ToolMeta('Agent-S3', ToolCategory.agents3, 'Open on desktop'),
  's3_bash': _ToolMeta('Agent-S3', ToolCategory.agents3, 'Shell (LocalEnv)'),
  's3_python': _ToolMeta('Agent-S3', ToolCategory.agents3, 'Python (LocalEnv)'),
  's3_code_task': _ToolMeta('Agent-S3', ToolCategory.agents3, 'CodeAgent task'),
  'gui_control': _ToolMeta('Agent-S3', ToolCategory.agents3, 'Desktop (GUI)'),
};

bool _isAgents3ToolId(String toolId) =>
    toolId == 'gui_control' || toolId.startsWith('s3_');

class FormattedTool {
  const FormattedTool(this.short, this.category, this.group);
  final String short;
  final ToolCategory category;
  final String group;
}

String _capitalize(String s) =>
    s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';

FormattedTool formatToolId(String toolId) {
  final meta = _toolMeta[toolId];
  if (meta != null) {
    return FormattedTool(meta.verb ?? meta.label, meta.category, meta.label);
  }
  if (_isAgents3ToolId(toolId)) {
    final human = toolId.replaceFirst(RegExp(r'^s3_'), '').replaceAll('_', ' ');
    return FormattedTool(_capitalize(human), ToolCategory.agents3, 'Agent-S3');
  }
  final human = toolId
      .replaceFirst(RegExp(r'^browser_ab_'), '')
      .replaceFirst(RegExp(r'^browser_'), '')
      .replaceAll('_', ' ');
  final ToolCategory category = toolId.startsWith('browser_')
      ? ToolCategory.browser
      : toolId.startsWith('brain_')
          ? ToolCategory.brain
          : (toolId.startsWith('system_') || toolId.startsWith('shell_'))
              ? ToolCategory.system
              : ToolCategory.other;
  final group = category == ToolCategory.browser
      ? 'Browser'
      : category == ToolCategory.brain
          ? 'AI Brain'
          : 'Tool';
  return FormattedTool(_capitalize(human), category, group);
}

String _formatToolList(List<String> toolIds) {
  return toolIds.map((id) {
    final f = formatToolId(id);
    return '${f.group}: ${f.short}';
  }).join(' · ');
}

const Set<ActivityKind> _toolActivityKinds = {
  ActivityKind.toolRound,
  ActivityKind.toolDone,
  ActivityKind.jitPending,
  ActivityKind.jitResolved,
};

/// Public entry point — returns null for lifecycle/plumbing events.
ActivityStep? summarizeRunnerLog(int seq, Object? raw) {
  final step = _buildActivityStep(seq, raw);
  if (step == null) return null;
  return _toolActivityKinds.contains(step.kind) ? step : null;
}

String _str(Object? v) => v == null ? '' : v.toString();

ActivityStep? _buildActivityStep(int seq, Object? raw) {
  if (raw is! Map) return null;
  final d = raw;
  final msg = _str(d['message']);
  if (msg.isEmpty) return null;
  final id = 'step-$seq';

  switch (msg) {
    case 'run_started':
      {
        final skills = d['skills'];
        final detail = skills is List && skills.isNotEmpty
            ? _formatToolList(skills.map(_str).toList())
            : null;
        return ActivityStep(
          id: id,
          label: 'Run started',
          detail: detail,
          tone: ActivityTone.accent,
          kind: ActivityKind.other,
        );
      }
    case 'route_decision':
      {
        final mode = _str(d['mode']);
        final detail = mode == 'direct'
            ? 'Single-shot runner path'
            : mode == 'orchestrator'
                ? 'Orchestrator path'
                : mode;
        return ActivityStep(
          id: id,
          label: 'Routing',
          detail: detail,
          tone: ActivityTone.accent,
          kind: ActivityKind.other,
        );
      }
    case 'inference_tool_round':
      {
        final tools = d['tools'] is List
            ? (d['tools'] as List).map(_str).where((t) => t.isNotEmpty).toList()
            : <String>[];
        final primary = tools.isNotEmpty ? formatToolId(tools.first) : null;
        final allAgents3 = tools.isNotEmpty && tools.every(_isAgents3ToolId);
        final label = tools.length == 1
            ? (primary?.group == 'Agent-S3'
                ? 'Agent-S3 — ${primary!.short}'
                : 'Using ${primary?.group ?? 'tool'}')
            : allAgents3
                ? 'Agent-S3 tools'
                : 'Using tools';
        return ActivityStep(
          id: id,
          label: label,
          detail: tools.isNotEmpty ? _formatToolList(tools) : null,
          tone: ActivityTone.accent,
          kind: ActivityKind.toolRound,
          category: primary?.category ?? ToolCategory.other,
          toolIds: tools,
        );
      }
    case 'tool_started':
      {
        final toolId = _str(d['tool']);
        final f = formatToolId(toolId);
        return ActivityStep(
          id: id,
          label: f.group == 'Agent-S3' ? 'Agent-S3 — ${f.short}' : 'Running — ${f.group}',
          detail: f.group == 'Agent-S3' ? toolId : f.short,
          tone: ActivityTone.accent,
          kind: ActivityKind.toolRound,
          category: f.category,
          toolIds: [toolId],
          toolId: toolId,
        );
      }
    case 'tool_finished':
      {
        final toolId = _str(d['tool']);
        final f = formatToolId(toolId);
        final failed = d['ok'] == false;
        if (failed) {
          final error = _str(d['error']).trim();
          return ActivityStep(
            id: id,
            label: f.group == 'Agent-S3' ? 'Failed — Agent-S3' : 'Failed — ${f.group}',
            detail: error.isNotEmpty ? error : '${f.short} failed',
            tone: ActivityTone.error,
            kind: ActivityKind.toolDone,
            category: f.category,
            toolId: toolId,
          );
        }
        return ActivityStep(
          id: id,
          label: f.group == 'Agent-S3' ? 'Done — Agent-S3' : 'Done — ${f.group}',
          detail: '${f.short}${toolId.isNotEmpty ? ' ($toolId)' : ''}',
          tone: ActivityTone.success,
          kind: ActivityKind.toolDone,
          category: f.category,
          toolId: toolId,
        );
      }
    case 'jit_approval_pending':
      {
        final scopeLabel = _str(d['scopeLabel'] ?? d['scope'] ?? 'action');
        final channel = _str(d['channel']);
        final context = _str(d['context']).trim();
        final parts = <String>[
          channel == 'whatsapp'
              ? 'Reply on WhatsApp to approve or deny'
              : 'Waiting for your approval in Qlix',
          if (scopeLabel.isNotEmpty) 'Scope: $scopeLabel',
          if (context.isNotEmpty) context,
        ];
        return ActivityStep(
          id: id,
          label: 'Waiting for your approval',
          detail: parts.join(' · '),
          tone: ActivityTone.warn,
          kind: ActivityKind.jitPending,
          category: ToolCategory.approval,
        );
      }
    case 'jit_approval_granted':
      {
        final scopeLabel = _str(d['scopeLabel'] ?? d['scope'] ?? '');
        final auto = d['auto'] == true;
        return ActivityStep(
          id: id,
          label: auto ? 'Pre-approved for this run' : 'You approved the action',
          detail: scopeLabel.isNotEmpty ? 'Scope: $scopeLabel' : null,
          tone: ActivityTone.success,
          kind: ActivityKind.jitResolved,
          category: ToolCategory.approval,
        );
      }
    case 'jit_approval_denied':
      return ActivityStep(
        id: id,
        label: 'You denied the action',
        detail: _str(d['scopeLabel'] ?? d['scope'] ?? ''),
        tone: ActivityTone.warn,
        kind: ActivityKind.jitResolved,
        category: ToolCategory.approval,
      );
    case 'jit_approval_expired':
      return ActivityStep(
        id: id,
        label: 'Approval request expired',
        detail: _str(d['scopeLabel'] ?? d['scope'] ?? ''),
        tone: ActivityTone.warn,
        kind: ActivityKind.jitResolved,
        category: ToolCategory.approval,
      );
    default:
      return ActivityStep(
        id: id,
        label: msg.replaceAll('_', ' '),
        tone: ActivityTone.neutral,
        kind: ActivityKind.other,
      );
  }
}

/// True while a JIT approval was requested and not yet resolved.
bool isWaitingForJitApproval(List<ActivityStep> steps) {
  var pendingIdx = -1;
  var resolvedIdx = -1;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].kind == ActivityKind.jitPending) pendingIdx = i;
    if (steps[i].kind == ActivityKind.jitResolved) resolvedIdx = i;
  }
  return pendingIdx >= 0 && resolvedIdx < pendingIdx;
}
