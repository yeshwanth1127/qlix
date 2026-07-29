import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../theme.dart';
import '../../ui/sketch.dart';
import 'sign_up_screen.dart';

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _submitting = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    final error = await ref.read(sessionControllerProvider.notifier).signIn(
          email: _email.text.trim(),
          password: _password.text,
        );
    if (!mounted) return;
    setState(() {
      _submitting = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    return SketchBackdrop(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const SectionIn(
                        child: Row(
                          children: [
                            QlixMark(size: 44),
                            SizedBox(width: 14),
                            Text(
                              'Qlix',
                              style: TextStyle(
                                fontSize: 28,
                                fontWeight: FontWeight.w700,
                                letterSpacing: -0.6,
                                color: QlixColors.ink,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 36),
                      const SectionIn(
                        index: 1,
                        child: Text(
                          'Sign in',
                          style: TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.5,
                            color: QlixColors.ink,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      const SectionIn(
                        index: 2,
                        child: Text(
                          'Welcome back. Chat with your agents on the go.',
                          style: TextStyle(
                            color: QlixColors.inkSecondary,
                            fontSize: 14,
                            height: 1.4,
                          ),
                        ),
                      ),
                      const SizedBox(height: 28),
                      SectionIn(
                        index: 3,
                        child: SketchCard(
                          padding: const EdgeInsets.all(18),
                          child: Column(
                            children: [
                              TextFormField(
                                controller: _email,
                                keyboardType: TextInputType.emailAddress,
                                autofillHints: const [AutofillHints.email],
                                decoration:
                                    const InputDecoration(labelText: 'Email'),
                                validator: (v) =>
                                    (v == null || !v.contains('@'))
                                        ? 'Enter a valid email'
                                        : null,
                              ),
                              const SizedBox(height: 12),
                              TextFormField(
                                controller: _password,
                                obscureText: true,
                                autofillHints: const [AutofillHints.password],
                                decoration: const InputDecoration(
                                    labelText: 'Password'),
                                onFieldSubmitted: (_) => _submit(),
                                validator: (v) => (v == null || v.isEmpty)
                                    ? 'Enter your password'
                                    : null,
                              ),
                              if (_error != null) ...[
                                const SizedBox(height: 14),
                                _ErrorBanner(message: _error!),
                              ],
                              const SizedBox(height: 18),
                              SketchPrimaryButton(
                                label: 'Sign in',
                                busy: _submitting,
                                onPressed: _submitting ? null : _submit,
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      SectionIn(
                        index: 4,
                        child: TextButton(
                          onPressed: _submitting
                              ? null
                              : () => Navigator.of(context).push(
                                    MaterialPageRoute<void>(
                                      builder: (_) => const SignUpScreen(),
                                    ),
                                  ),
                          child: const Text("Don't have an account? Sign up"),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
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
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: QlixColors.redSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: QlixColors.red.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: QlixColors.red, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: QlixColors.red, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}
