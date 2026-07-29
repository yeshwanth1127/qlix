import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/dashboard.dart';
import '../../repositories/dashboard_repository.dart';

final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  return DashboardRepository(client: ref.watch(apiClientProvider));
});

final dashboardHomeProvider = FutureProvider.autoDispose<DashboardHome>((ref) {
  return ref.watch(dashboardRepositoryProvider).getHome();
});
