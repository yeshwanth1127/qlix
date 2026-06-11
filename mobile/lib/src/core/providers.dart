import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/session.dart';
import '../features/ai_builder/ai_builder_controller.dart';
import '../repositories/agents_repository.dart';
import '../repositories/auth_repository.dart';
import '../repositories/chat_repository.dart';
import '../repositories/nl_builder_repository.dart';
import 'api_client.dart';
import 'secure_store.dart';

final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  final store = ref.watch(secureStoreProvider);
  return ApiClient(store: store);
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    client: ref.watch(apiClientProvider),
    store: ref.watch(secureStoreProvider),
  );
});

final agentsRepositoryProvider = Provider<AgentsRepository>((ref) {
  return AgentsRepository(client: ref.watch(apiClientProvider));
});

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepository(client: ref.watch(apiClientProvider));
});

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({required this.status, this.session, this.busy = false});

  final AuthStatus status;
  final Session? session;
  final bool busy;

  AuthState copyWith({AuthStatus? status, Session? session, bool? busy}) {
    return AuthState(
      status: status ?? this.status,
      session: session ?? this.session,
      busy: busy ?? this.busy,
    );
  }

  static const unknown = AuthState(status: AuthStatus.unknown);
}

/// Owns the authenticated session lifecycle: bootstrap from storage, sign in /
/// up, sign out, and forced sign-out on an unrecoverable 401.
class SessionController extends StateNotifier<AuthState> {
  SessionController(this._auth) : super(AuthState.unknown);

  final AuthRepository _auth;

  Future<void> bootstrap() async {
    final session = await _auth.me();
    if (session == null) {
      state = const AuthState(status: AuthStatus.unauthenticated);
    } else {
      state = AuthState(status: AuthStatus.authenticated, session: session);
    }
  }

  Future<String?> signIn({required String email, required String password}) async {
    state = state.copyWith(busy: true);
    final result = await _auth.login(email: email, password: password);
    if (result.ok && result.session != null) {
      state = AuthState(status: AuthStatus.authenticated, session: result.session);
      return null;
    }
    state = state.copyWith(busy: false);
    return result.errorMessage ?? 'Login failed';
  }

  Future<String?> signUp({
    required String email,
    required String password,
    String? displayName,
    required String workspaceType,
  }) async {
    state = state.copyWith(busy: true);
    final result = await _auth.signup(
      email: email,
      password: password,
      displayName: displayName,
      workspaceType: workspaceType,
    );
    if (result.ok && result.session != null) {
      state = AuthState(status: AuthStatus.authenticated, session: result.session);
      return null;
    }
    state = state.copyWith(busy: false);
    return result.errorMessage ?? 'Sign up failed';
  }

  Future<void> signOut() async {
    await _auth.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  void handleUnauthorized() {
    if (state.status != AuthStatus.unauthenticated) {
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }
}

final sessionControllerProvider =
    StateNotifierProvider<SessionController, AuthState>((ref) {
  final controller = SessionController(ref.watch(authRepositoryProvider));
  // Wire forced sign-out on an unrecoverable 401. Done here (not inside
  // apiClientProvider) so the providers don't form an initialization cycle.
  ref.read(apiClientProvider).onUnauthorized = controller.handleUnauthorized;
  return controller;
});

final nlBuilderRepositoryProvider = Provider<NlBuilderRepository>((ref) {
  return NlBuilderRepository(client: ref.watch(apiClientProvider));
});

final builderControllerProvider =
    StateNotifierProvider<BuilderController, BuilderState>((ref) {
  return BuilderController(ref.watch(nlBuilderRepositoryProvider));
});
