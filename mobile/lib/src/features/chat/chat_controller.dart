// Repositories are injected as named params that back private fields; an
// initializing formal cannot be private for a public named parameter.
// ignore_for_file: prefer_initializing_formals

import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/agent.dart';
import '../../models/chat.dart';
import '../../repositories/agents_repository.dart';
import '../../repositories/chat_repository.dart';
import 'agent_tool_activity.dart';

class ChatState {
  const ChatState({
    this.loading = true,
    this.agent,
    this.conversationId,
    this.messages = const [],
    this.browserFrames = const [],
    this.sending = false,
    this.clearing = false,
    this.currentRunId,
    this.error,
  });

  final bool loading;
  final AgentDTO? agent;
  final String? conversationId;
  final List<ChatMessage> messages;
  final List<BrowserFrame> browserFrames;
  final bool sending;
  final bool clearing;
  final String? currentRunId;
  final String? error;

  bool get canUseBrain =>
      agent?.permissionScopes.contains('brain.query') ?? false;

  ChatState copyWith({
    bool? loading,
    AgentDTO? agent,
    String? conversationId,
    List<ChatMessage>? messages,
    List<BrowserFrame>? browserFrames,
    bool? sending,
    bool? clearing,
    String? currentRunId,
    bool clearRunId = false,
    String? error,
    bool clearError = false,
  }) {
    return ChatState(
      loading: loading ?? this.loading,
      agent: agent ?? this.agent,
      conversationId: conversationId ?? this.conversationId,
      messages: messages ?? this.messages,
      browserFrames: browserFrames ?? this.browserFrames,
      sending: sending ?? this.sending,
      clearing: clearing ?? this.clearing,
      currentRunId: clearRunId ? null : (currentRunId ?? this.currentRunId),
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// Backoff schedule (ms) for reconciling conversation messages after a run,
/// ported from `fetchMessagesAfterRun` in `AgentChatPanel.tsx`.
const _refetchDelaysMs = [0, 300, 600, 1000, 1500, 2500];

class ChatController extends StateNotifier<ChatState> {
  ChatController({
    required this.agentId,
    required ChatRepository chat,
    required AgentsRepository agents,
  })  : _chat = chat,
        _agents = agents,
        super(const ChatState());

  final String agentId;
  final ChatRepository _chat;
  final AgentsRepository _agents;

  StreamSubscription<dynamic>? _streamSub;

  // Streaming run state preserved across the reconcile on `done`.
  String _assistantId = '';
  String _streamingContent = '';
  List<ActivityStep> _streamingActivity = [];
  List<BrowserFrame> _streamingFrames = [];

  Future<void> init() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      // Agent metadata (runtime, model, brain scope) is best-effort.
      AgentDTO? agent;
      try {
        agent = (await _agents.getAgent(agentId)).agent;
      } catch (_) {}

      final conversationId = await _chat.createConversation(agentId);
      final rows = await _chat.listMessages(agentId, conversationId);
      final messages = (rows ?? [])
          .map((m) => ChatMessage(
                id: m.id,
                role: chatRoleFromString(m.role),
                content: m.content,
              ))
          .toList();
      state = state.copyWith(
        loading: false,
        agent: agent,
        conversationId: conversationId,
        messages: messages,
      );
    } catch (e) {
      state = state.copyWith(loading: false, error: '$e');
    }
  }

  Future<void> send(String text, {String? model, bool useBrain = false}) async {
    final conversationId = state.conversationId;
    if (conversationId == null || state.sending) return;
    final content = text.trim();
    if (content.isEmpty) return;

    final userMsg = ChatMessage(
      id: 'local-${DateTime.now().microsecondsSinceEpoch}',
      role: ChatRole.user,
      content: content,
    );
    state = state.copyWith(
      messages: [...state.messages, userMsg],
      sending: true,
      clearError: true,
    );

    final hosted = state.agent?.isHostedChatRuntime ?? true;
    final result = await _chat.postMessage(
      agentId: agentId,
      conversationId: conversationId,
      content: content,
      model: hosted ? model : null,
      useBrain: state.canUseBrain && useBrain,
    );

    if (!result.ok || result.runId == null) {
      final msg = result.insufficientBalance
          ? 'Insufficient wallet balance. Add credits in the Qlix web app to continue.'
          : (result.errorMessage ?? 'Failed to send message');
      state = state.copyWith(sending: false, error: msg);
      return;
    }

    final runId = result.runId!;
    _assistantId = 'run-$runId';
    _streamingContent = '';
    _streamingActivity = [];
    _streamingFrames = [];

    final assistant = ChatMessage(
      id: _assistantId,
      role: ChatRole.agent,
      content: '',
    );
    state = state.copyWith(
      currentRunId: runId,
      browserFrames: [],
      messages: [...state.messages, assistant],
    );

    await _openStream(conversationId, runId);
  }

  Future<void> _openStream(String conversationId, String runId) async {
    try {
      final events = await _chat.streamRun(agentId, runId);
      _streamSub = events.listen(
        (evt) => _onSseEvent(conversationId, evt.event, evt.data),
        onError: (_) => _reconcile(conversationId, status: null),
        onDone: () {
          // If the server never sent an explicit `done`, still reconcile.
          if (state.currentRunId == runId) {
            _reconcile(conversationId, status: null);
          }
        },
        cancelOnError: true,
      );
    } catch (_) {
      await _reconcile(conversationId, status: null);
    }
  }

  void _onSseEvent(String conversationId, String event, String data) {
    switch (event) {
      case 'delta':
        _handleDelta(data);
        break;
      case 'log':
        _handleLog(data);
        break;
      case 'done':
        String? status;
        try {
          final parsed = jsonDecode(data);
          if (parsed is Map && parsed['status'] is String) {
            status = parsed['status'] as String;
          }
        } catch (_) {}
        _reconcile(conversationId, status: status);
        break;
      default:
        break;
    }
  }

  void _handleDelta(String data) {
    try {
      final parsed = jsonDecode(data);
      final text = parsed is Map &&
              parsed['data'] is Map &&
              (parsed['data'] as Map)['text'] is String
          ? (parsed['data'] as Map)['text'] as String
          : '';
      if (text.isEmpty) return;
      _streamingContent += text;
      _updateAssistant(content: _streamingContent);
    } catch (_) {}
  }

  void _handleLog(String data) {
    try {
      final parsed = jsonDecode(data);
      if (parsed is! Map) return;
      final seq = parsed['seq'] is int ? parsed['seq'] as int : 0;
      final raw = parsed['data'];
      if (raw is Map &&
          raw['message'] == 'browser_frame' &&
          raw['image_base64'] is String) {
        final frame = BrowserFrame(
          id: 'frame-$seq',
          tool: (raw['tool'] ?? 'browser').toString(),
          label: (raw['label'] ?? 'Browser action').toString(),
          mime: (raw['mime'] ?? 'image/png').toString(),
          imageBase64: raw['image_base64'] as String,
        );
        _streamingFrames = [..._streamingFrames, frame];
        _updateAssistant(browserFrames: _streamingFrames);
        state = state.copyWith(browserFrames: _streamingFrames);
        return;
      }
      final step = summarizeRunnerLog(seq, raw);
      if (step == null) return;
      _streamingActivity = [..._streamingActivity, step];
      _updateAssistant(activity: _streamingActivity);
    } catch (_) {}
  }

  void _updateAssistant({
    String? content,
    List<ActivityStep>? activity,
    List<BrowserFrame>? browserFrames,
  }) {
    final messages = [
      for (final m in state.messages)
        if (m.id == _assistantId)
          m.copyWith(
            content: content,
            activity: activity,
            browserFrames: browserFrames,
          )
        else
          m,
    ];
    state = state.copyWith(messages: messages);
  }

  Future<void> _reconcile(String conversationId, {String? status}) async {
    await _streamSub?.cancel();
    _streamSub = null;

    final preservedContent = _streamingContent;
    final preservedActivity = List<ActivityStep>.from(_streamingActivity);
    final preservedFrames = List<BrowserFrame>.from(_streamingFrames);
    _streamingContent = '';
    _streamingActivity = [];
    _streamingFrames = [];

    final rows = await _fetchMessagesAfterRun(conversationId, status);
    if (rows != null) {
      final merged = _mergeServerMessages(
        rows,
        preservedContent: preservedContent,
        preservedActivity: preservedActivity,
        preservedFrames: preservedFrames,
      );
      state = state.copyWith(
        messages: merged,
        sending: false,
        clearRunId: true,
        browserFrames: preservedFrames.isNotEmpty
            ? preservedFrames
            : state.browserFrames,
        error: status == 'failed' ? _failedMessage() : null,
        clearError: status != 'failed',
      );
    } else if (preservedContent.trim().isNotEmpty) {
      _updateAssistant(
        content: preservedContent,
        activity: preservedActivity,
        browserFrames: preservedFrames,
      );
      state = state.copyWith(
        sending: false,
        clearRunId: true,
        error: status == 'failed' ? _failedMessage() : null,
        clearError: status != 'failed',
      );
    } else {
      state = state.copyWith(
        sending: false,
        clearRunId: true,
        error: status == 'failed' ? _failedMessage() : null,
        clearError: status != 'failed',
      );
    }
  }

  String _failedMessage() =>
      'The agent run failed. Check the Qlix web app or server logs for details.';

  Future<List<ServerMessage>?> _fetchMessagesAfterRun(
    String conversationId,
    String? status,
  ) async {
    for (final ms in _refetchDelaysMs) {
      if (ms > 0) {
        await Future<void>.delayed(Duration(milliseconds: ms));
      }
      final rows = await _chat.listMessages(agentId, conversationId);
      if (rows == null) continue;
      final lastAgent = rows.reversed.where((m) => m.role == 'agent');
      final lastAgentContent =
          lastAgent.isEmpty ? '' : lastAgent.first.content.trim();
      if (status == 'failed' || lastAgentContent.isNotEmpty) {
        return rows;
      }
    }
    return _chat.listMessages(agentId, conversationId);
  }

  List<ChatMessage> _mergeServerMessages(
    List<ServerMessage> rows, {
    required String preservedContent,
    required List<ActivityStep> preservedActivity,
    required List<BrowserFrame> preservedFrames,
  }) {
    var lastAgentIdx = -1;
    for (var i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role == 'agent') {
        lastAgentIdx = i;
        break;
      }
    }
    final result = <ChatMessage>[];
    for (var i = 0; i < rows.length; i++) {
      final m = rows[i];
      final isLastAgent = i == lastAgentIdx;
      final serverContent = m.content;
      final content =
          isLastAgent && serverContent.trim().isEmpty && preservedContent.trim().isNotEmpty
              ? preservedContent
              : serverContent;
      result.add(ChatMessage(
        id: m.id,
        role: chatRoleFromString(m.role),
        content: content,
        activity: isLastAgent && preservedActivity.isNotEmpty
            ? preservedActivity
            : null,
        browserFrames: isLastAgent && preservedFrames.isNotEmpty
            ? preservedFrames
            : null,
      ));
    }
    return result;
  }

  Future<void> stop() async {
    final runId = state.currentRunId;
    final conversationId = state.conversationId;
    await _streamSub?.cancel();
    _streamSub = null;
    if (runId != null) {
      await _chat.stopRun(agentId, runId);
    }
    state = state.copyWith(sending: false, clearRunId: true);
    // Reconcile so a partial/empty assistant bubble is replaced by the
    // server's final messages (same path as a dropped stream).
    if (conversationId != null) {
      await _reconcile(conversationId, status: 'stopped');
    }
  }

  Future<void> clear() async {
    final conversationId = state.conversationId;
    if (conversationId == null || state.clearing) return;
    state = state.copyWith(clearing: true);
    await _streamSub?.cancel();
    _streamSub = null;
    final ok = await _chat.clearMessages(agentId, conversationId);
    state = state.copyWith(
      clearing: false,
      messages: ok ? [] : state.messages,
      browserFrames: ok ? [] : state.browserFrames,
      sending: false,
      clearRunId: true,
      clearError: true,
    );
  }

  @override
  void dispose() {
    _streamSub?.cancel();
    super.dispose();
  }
}

final chatControllerProvider = StateNotifierProvider.family
    .autoDispose<ChatController, ChatState, String>((ref, agentId) {
  final controller = ChatController(
    agentId: agentId,
    chat: ref.watch(chatRepositoryProvider),
    agents: ref.watch(agentsRepositoryProvider),
  );
  controller.init();
  return controller;
});
