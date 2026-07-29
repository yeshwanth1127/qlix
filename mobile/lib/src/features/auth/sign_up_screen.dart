import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../theme.dart';
import '../../ui/sketch.dart';

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
    return SketchBackdrop(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: const Text('Create account'),
          backgroundColor: Colors.transparent,
        ),
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
                        child: Text(
                          'Are you using this for yourself or your team?',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: QlixColors.ink,
                            height: 1.35,
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      SectionIn(
                        index: 1,
                        child: SketchCard(
                          padding: const EdgeInsets.all(18),
                          child: Column(
                            children: [
                              TextFormField(
                                controller: _displayName,
                                decoration: const InputDecoration(
                                  labelText: 'Display name (optional)',
                                ),
                              ),
                              const SizedBox(height: 12),
                              TextFormField(
                                controller: _email,
                                keyboardType: TextInputType.emailAddress,
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
                                decoration: const InputDecoration(
                                  labelText: 'Password (min 8 characters)',
                                ),
                                validator: (v) => (v == null || v.length < 8)
                                    ? 'Use at least 8 characters'
                                    : null,
                              ),
                              const SizedBox(height: 16),
                              SegmentedButton<String>(
                                style: ButtonStyle(
                                  foregroundColor:
                                      WidgetStateProperty.resolveWith((s) {
                                    if (s.contains(WidgetState.selected)) {
                                      return QlixColors.accent;
                                    }
                                    return QlixColors.inkSecondary;
                                  }),
                                  backgroundColor:
                                      WidgetStateProperty.resolveWith((s) {
                                    if (s.contains(WidgetState.selected)) {
                                      return QlixColors.accentSoft;
                                    }
                                    return Colors.transparent;
                                  }),
                                ),
                                segments: const [
                                  ButtonSegment(
                                    value: 'individual',
                                    label: Text('Individual'),
                                    icon: Icon(Icons.person_outline, size: 16),
                                  ),
                                  ButtonSegment(
                                    value: 'organization',
                                    label: Text('Organization'),
                                    icon: Icon(Icons.apartment_outlined, size: 16),
                                  ),
                                ],
                                selected: {_workspaceType},
                                onSelectionChanged: (s) =>
                                    setState(() => _workspaceType = s.first),
                              ),
                              if (_error != null) ...[
                                const SizedBox(height: 14),
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: QlixColors.redSoft,
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                      color: QlixColors.red
                                          .withValues(alpha: 0.35),
                                    ),
                                  ),
                                  child: Text(
                                    _error!,
                                    style: const TextStyle(
                                      color: QlixColors.red,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                              ],
                              const SizedBox(height: 18),
                              SketchPrimaryButton(
                                label: 'Create account',
                                busy: _submitting,
                                onPressed: _submitting ? null : _submit,
                              ),
                            ],
                          ),
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
