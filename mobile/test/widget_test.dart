import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:qlix_mobile/src/app.dart';

void main() {
  testWidgets('App boots to a loading gate then sign-in', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: QlixApp()));
    // The root gate shows a spinner while bootstrap runs.
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
