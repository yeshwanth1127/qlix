import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/providers.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/shell/app_shell.dart';
import 'theme.dart';

class QlixApp extends StatelessWidget {
  const QlixApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Qlix',
      debugShowCheckedModeBanner: false,
      theme: buildQlixTheme(),
      home: const _RootGate(),
    );
  }
}

/// Routes between sign-in and the app shell based on the session status, and
/// kicks off the `/auth/me` rehydration on launch.
class _RootGate extends ConsumerStatefulWidget {
  const _RootGate();

  @override
  ConsumerState<_RootGate> createState() => _RootGateState();
}

class _RootGateState extends ConsumerState<_RootGate> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(sessionControllerProvider.notifier).bootstrap(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(sessionControllerProvider).status;
    return switch (status) {
      AuthStatus.unknown =>
        const Scaffold(body: Center(child: CircularProgressIndicator())),
      AuthStatus.unauthenticated => const SignInScreen(),
      AuthStatus.authenticated => const AppShell(),
    };
  }
}
