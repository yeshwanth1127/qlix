import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../features/chat/sse_parser.dart';

class ServerMessage {
  const ServerMessage({required this.id, required this.role, required this.content});
  final String id;
  final String role;
  final String content;
}

class PostMessageResult {
  const PostMessageResult({
    required this.ok,
    this.runId,
    this.messageId,
    this.errorMessage,
    this.statusCode,
  });

  final bool ok;
  final String? runId;
  final String? messageId;
  final String? errorMessage;
  final int? statusCode;

  bool get insufficientBalance => statusCode == 402;
}

/// Conversation + message + run-stream endpoints from `createAgentChatRouter`.
class ChatRepository {
  ChatRepository({required this.client});

  final ApiClient client;

  Future<String> createConversation(String agentId) async {
    final res = await client.dio.post<dynamic>(
      '/agents/$agentId/conversations',
      data: const <String, dynamic>{},
    );
    final data = res.data;
    if (res.statusCode == 200 && data is Map && data['conversationId'] is String) {
      return data['conversationId'] as String;
    }
    throw DioException(
      requestOptions: res.requestOptions,
      response: res,
      error: apiErrorMessage(data, 'Failed to open conversation'),
    );
  }

  Future<List<ServerMessage>?> listMessages(
    String agentId,
    String conversationId,
  ) async {
    try {
      final res = await client.dio.get<dynamic>(
        '/agents/$agentId/conversations/$conversationId/messages',
      );
      final data = res.data;
      if (res.statusCode == 200 && data is Map && data['messages'] is List) {
        return (data['messages'] as List)
            .whereType<Map>()
            .map((m) => ServerMessage(
                  id: m['id']?.toString() ?? '',
                  role: m['role']?.toString() ?? 'system',
                  content: m['content']?.toString() ?? '',
                ))
            .toList();
      }
      return null;
    } on DioException {
      return null;
    }
  }

  Future<bool> clearMessages(String agentId, String conversationId) async {
    try {
      final res = await client.dio.delete<dynamic>(
        '/agents/$agentId/conversations/$conversationId/messages',
      );
      return res.statusCode == 200;
    } on DioException {
      return false;
    }
  }

  Future<PostMessageResult> postMessage({
    required String agentId,
    required String conversationId,
    required String content,
    String? model,
    bool useBrain = false,
  }) async {
    try {
      final body = <String, dynamic>{
        'content': content,
        if (model != null && model.trim().isNotEmpty) 'model': model.trim(),
        if (useBrain) 'useBrain': true,
      };
      final res = await client.dio.post<dynamic>(
        '/agents/$agentId/conversations/$conversationId/messages',
        data: body,
      );
      final data = res.data;
      if (res.statusCode == 200 && data is Map && data['runId'] is String) {
        return PostMessageResult(
          ok: true,
          runId: data['runId'] as String,
          messageId: data['messageId']?.toString(),
        );
      }
      return PostMessageResult(
        ok: false,
        statusCode: res.statusCode,
        errorMessage: apiErrorMessage(data, 'Failed to send message'),
      );
    } on DioException catch (e) {
      return PostMessageResult(
        ok: false,
        statusCode: e.response?.statusCode,
        errorMessage: apiErrorMessage(e.response?.data, 'Failed to send message'),
      );
    }
  }

  Future<void> stopRun(String agentId, String runId) async {
    try {
      await client.dio.post<dynamic>('/agents/$agentId/runs/$runId/stop');
    } catch (_) {
      // Best-effort.
    }
  }

  /// Opens the SSE stream for a run and yields parsed events. The bearer token
  /// is injected by the [ApiClient] interceptor.
  Future<Stream<SseEvent>> streamRun(String agentId, String runId) async {
    final res = await client.dio.get<ResponseBody>(
      '/agents/$agentId/runs/$runId/stream',
      options: Options(
        responseType: ResponseType.stream,
        headers: {'Accept': 'text/event-stream'},
        // SSE stays open well beyond the default receive timeout.
        receiveTimeout: Duration.zero,
      ),
    );
    final body = res.data;
    if (body == null) {
      throw DioException(
        requestOptions: res.requestOptions,
        response: res,
        error: 'Failed to open run stream',
      );
    }
    return parseSse(body.stream);
  }
}
