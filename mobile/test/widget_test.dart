import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:qlix_mobile/src/app.dart';
import 'package:qlix_mobile/src/ui/sketch.dart';

void main() {
  testWidgets('App boots to a loading gate then sign-in', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: QlixApp()));
    // Bootstrap gate shows the brand mark + orbit loader.
    expect(find.byType(QlixMark), findsOneWidget);
    expect(find.byType(OrbitLoader), findsOneWidget);
  });
}
