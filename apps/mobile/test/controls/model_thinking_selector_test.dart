import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/controls/controls.dart';

Widget _wrap(Widget child, {TextScaler scaler = TextScaler.noScaling}) {
  return MaterialApp(
    home: Scaffold(
      body: MediaQuery(
        data: MediaQueryData(textScaler: scaler),
        child: child,
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('unavailable restored model surfaces explicit copy', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        ModelThinkingSelector(
          data: const ModelThinkingViewData(
            models: <ModelOptionData>[
              ModelOptionData(
                id: 'm1',
                label: 'Sonnet',
                provider: 'Anthropic',
                thinkingLevels: <String>['low', 'high'],
              ),
            ],
            unavailableRestoredModel: 'Old Sonnet',
          ),
          callbacks: ModelThinkingCallbacks(
            onModelSelected: (_) {},
            onThinkingSelected: (_) {},
          ),
        ),
      ),
    );
    expect(find.byKey(const Key('unavailable-restored-model')), findsOneWidget);
    expect(find.textContaining('Old Sonnet'), findsOneWidget);
    // An available model is still listed and selectable.
    expect(find.text('Sonnet'), findsOneWidget);
  });

  testWidgets('model select + thinking select fire callbacks', (tester) async {
    String? modelId;
    String? thinking;
    await tester.pumpWidget(
      _wrap(
        ModelThinkingSelector(
          data: const ModelThinkingViewData(
            models: <ModelOptionData>[
              ModelOptionData(
                id: 'm1',
                label: 'Sonnet',
                provider: 'Anthropic',
                thinkingLevels: <String>['low', 'high'],
              ),
              ModelOptionData(
                id: 'm2',
                label: 'Opus',
                provider: 'Anthropic',
                thinkingLevels: <String>['low', 'high'],
              ),
            ],
            selectedModelId: 'm1',
            selectedThinkingLevel: 'low',
          ),
          callbacks: ModelThinkingCallbacks(
            onModelSelected: (id) => modelId = id,
            onThinkingSelected: (level) => thinking = level,
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(ValueKey('model-m2')));
    await tester.pump();
    expect(modelId, 'm2');
    // Thinking dropdown re-renders for the selected model.
    expect(find.byKey(const Key('thinking-selector')), findsOneWidget);
    await tester.tap(find.byKey(const Key('thinking-selector')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('high').last);
    await tester.pumpAndSettle();
    expect(thinking, 'high');
  });

  testWidgets('empty host models render unsupported state', (tester) async {
    await tester.pumpWidget(
      _wrap(
        ModelThinkingSelector(
          data: const ModelThinkingViewData(models: <ModelOptionData>[]),
          callbacks: const ModelThinkingCallbacks(),
        ),
      ),
    );
    expect(find.byKey(const Key('unsupported-control-state')), findsOneWidget);
  });

  testWidgets('renders at 200% text scaling without overflow', (tester) async {
    await tester.pumpWidget(
      _wrap(
        ModelThinkingSelector(
          data: const ModelThinkingViewData(
            models: <ModelOptionData>[
              ModelOptionData(
                id: 'm1',
                label: 'Sonnet',
                provider: 'Anthropic',
                thinkingLevels: <String>['low', 'high'],
              ),
            ],
            selectedModelId: 'm1',
            selectedThinkingLevel: 'low',
            unavailableRestoredModel: 'Old Sonnet',
          ),
          callbacks: ModelThinkingCallbacks(
            onModelSelected: (_) {},
            onThinkingSelected: (_) {},
          ),
        ),
        scaler: const TextScaler.linear(2.0),
      ),
    );
    expect(tester.takeException(), isNull);
  });
}
