import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../models/agent.dart';

/// Agent read endpoints (`GET /agents`, `GET /agents/:id`).
class AgentsRepository {
  AgentsRepository({required this.client});

  final ApiClient client;

  Future<List<AgentDTO>> listAgents(String? orgId) async {
    final res = await client.dio.get<dynamic>(
      '/agents',
      queryParameters: {if (orgId != null && orgId.isNotEmpty) 'orgId': orgId},
    );
    final data = res.data;
    if (res.statusCode == 200 && data is Map && data['agents'] is List) {
      return (data['agents'] as List)
          .whereType<Map<String, dynamic>>()
          .map(AgentDTO.fromJson)
          .toList();
    }
    throw DioException(
      requestOptions: res.requestOptions,
      response: res,
      error: apiErrorMessage(data, 'Failed to load agents'),
    );
  }

  Future<AgentDetail> getAgent(String id) async {
    final res = await client.dio.get<dynamic>('/agents/$id');
    final data = res.data;
    if (res.statusCode == 200 && data is Map<String, dynamic>) {
      return AgentDetail.fromJson(data);
    }
    throw DioException(
      requestOptions: res.requestOptions,
      response: res,
      error: apiErrorMessage(data, 'Agent not found'),
    );
  }
}
