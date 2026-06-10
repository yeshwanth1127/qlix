import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';

class SignUpScreen extends ConsumerStatefulWidget {
  const SignUpScreen({super.key});

  @override
  ConsumerState<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends ConsumerState<SignUpScreen> {
  final _formKey = GlobalKey<FormState>();
  final _displayName = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String _workspaceType = 'individual';
  String? _error;
  bool _submitting = false;

  @override
  void dispose() {
    _displayName.dispose();
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
    final error = await ref.read(sessionControllerProvider.notifier).signUp(
          email: _email.text.trim(),
          password: _password.text,
          displayName: _displayName.text.trim(),
          workspaceType: _workspaceType,
        );
    if (!mounted) return;
    if (error == null) {
      // Authenticated — the root listener will swap to the app shell.
      Navigator.of(context).popUntil((r) => r.isFirst);
      return;
    }
    setState(() {
      _submitting = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create account')),
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
                    TextFormField(
                      controller: _displayName,
                      decoration:
                          const InputDecoration(labelText: 'Display name (optional)'),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'Email'),
                      validator: (v) => (v == null || !v.contains('@'))
                          ? 'Enter a valid email'
                          : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _password,
                      obscureText: true,
                      decoration: const InputDecoration(
                        labelText: 'Password (min 8 characters)',
                      ),
                      validator: (v) => (v == null || v.length < 8)
                          ? 'Use at least 8 characters'
                          : null,
                    ),
                    const SizedBox(height: 16),
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(
                          value: 'individual',
                          label: Text('Individual'),
                          icon: Icon(Icons.person_outline),
                        ),
                        ButtonSegment(
                          value: 'organization',
                          label: Text('Organization'),
                          icon: Icon(Icons.apartment_outlined),
                        ),
                      ],
                      selected: {_workspaceType},
                      onSelectionChanged: (s) =>
                          setState(() => _workspaceType = s.first),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF2A1416),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFF87171)),
                        ),
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Color(0xFFFCA5A5)),
                        ),
                      ),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _submitting ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Create account'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
