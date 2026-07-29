import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../models/dashboard.dart';

/// Dashboard home endpoint (`GET /dashboard/home`).
class DashboardRepository {
  DashboardRepository({required this.client});

  final ApiClient client;

  Future<DashboardHome> getHome() async {
    final res = await client.dio.get<dynamic>('/dashboard/home');
    final data = res.data;
    if (res.statusCode == 200 && data is Map<String, dynamic>) {
      return DashboardHome.fromJson(data);
    }
    throw DioException(
      requestOptions: res.requestOptions,
      response: res,
      error: apiErrorMessage(data, 'Failed to load dashboard'),
    );
  }
}
