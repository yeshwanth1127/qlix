// Domain models for the agent chat surface. These are plain mutable-friendly
// value classes (not freezed) because they are assembled incrementally from
// the SSE stream and reconciled against refetched server messages.

enum ChatRole { user, agent, system }

ChatRole chatRoleFromString(String raw) {
  switch (raw) {
    case 'user':
      return ChatRole.user;
    case 'agent':
      return ChatRole.agent;
    default:
      return ChatRole.system;
  }
}

enum ActivityTone { neutral, accent, success, warn, error }

enum ToolCategory { browser, brain, system, agents3, approval, other }

enum ActivityKind { toolRound, toolDone, jitPending, jitResolved, other }

/// Mirrors `ActivityStep` from `agentToolActivity.ts`.
class ActivityStep {
  const ActivityStep({
    required this.id,
    required this.label,
    this.detail,
    this.tone = ActivityTone.neutral,
    this.category,
    this.kind = ActivityKind.other,
    this.toolIds = const <String>[],
    this.toolId,
  });

  final String id;
  final String label;
  final String? detail;
  final ActivityTone tone;
  final ToolCategory? category;
  final ActivityKind kind;
  final List<String> toolIds;
  final String? toolId;
}

/// Mirrors `BrowserFrame` from `AgentBrowserLiveView`.
class BrowserFrame {
  const BrowserFrame({
    required this.id,
    required this.tool,
    required this.label,
    required this.mime,
    required this.imageBase64,
  });

  final String id;
  final String tool;
  final String label;
  final String mime;
  final String imageBase64;
}

/// Mirrors `ChatMsg` from `AgentChatPanel.tsx`.
class ChatMessage {
  ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    List<ActivityStep>? activity,
    List<BrowserFrame>? browserFrames,
  })  : activity = activity ?? <ActivityStep>[],
        browserFrames = browserFrames ?? <BrowserFrame>[];

  final String id;
  final ChatRole role;
  String content;
  List<ActivityStep> activity;
  List<BrowserFrame> browserFrames;

  ChatMessage copyWith({
    String? content,
    List<ActivityStep>? activity,
    List<BrowserFrame>? browserFrames,
  }) {
    return ChatMessage(
      id: id,
      role: role,
      content: content ?? this.content,
      activity: activity ?? this.activity,
      browserFrames: browserFrames ?? this.browserFrames,
    );
  }
}
