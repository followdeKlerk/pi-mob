import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/recipe_activity/domain/recipe_activity.dart';
import 'package:pi_mob/src/recipe_activity/widgets/recipe_activity_view.dart';

StreamEventState event(int cursor, String type, Map<String, Object?> payload) =>
    StreamEventState(
      hostId: 'host',
      streamId: 'session:s',
      cursor: StreamCursor.parse('$cursor'),
      eventId: 'event-$cursor',
      type: type,
      payload: payload,
      occurredAt: DateTime.utc(2026, 1, 1, 0, 0, cursor),
    );

void main() {
  test('projects normalized activities without promoting reasoning text', () {
    final result = projectRecipeActivities([
      event(1, 'turn.started', {'sessionId': 's', 'turnId': 't'}),
      event(2, 'reasoning.started', {
        'sessionId': 's',
        'turnId': 't',
        'contentBlockId': 'r',
      }),
      event(3, 'reasoning.delta', {
        'sessionId': 's',
        'turnId': 't',
        'contentBlockId': 'r',
        'text': 'private',
      }),
      event(4, 'reasoning.completed', {
        'sessionId': 's',
        'turnId': 't',
        'contentBlockId': 'r',
      }),
      event(5, 'tool.started', {
        'sessionId': 's',
        'turnId': 't',
        'toolCallId': 'a',
        'toolName': 'read',
        'arguments': {'path': 'README.md'},
      }),
      event(6, 'tool.completed', {
        'sessionId': 's',
        'turnId': 't',
        'toolCallId': 'a',
        'result': {'output': 'ok'},
      }),
    ]);
    expect(result, hasLength(2));
    expect(result.first.kind, RecipeActivityKind.thinking);
    expect(result.first.status, RecipeActivityStatus.completed);
    expect(result.first.title, 'Thinking');
    expect(result.last.toolName, 'read');
    expect(result.last.status, RecipeActivityStatus.completed);
  });

  test('replay dedupe and bounds arguments', () {
    final start = event(1, 'tool.started', {
      'sessionId': 's',
      'turnId': 't',
      'toolCallId': 'a',
      'toolName': 'bash',
      'arguments': 'x' * 400,
    });
    final result = projectRecipeActivities([
      start,
      start,
      event(2, 'reasoning.started', {
        'sessionId': 's',
        'turnId': 't',
        'contentBlockId': 'a',
      }),
    ]);
    expect(result, hasLength(1));
    expect(result.single.kind, RecipeActivityKind.tool);
    expect(result.single.arguments, hasLength(240));
    expect(result.single.truncation, isNull);
  });

  test('rejects oversized and malformed activity identities', () {
    final result = projectRecipeActivities([
      event(1, 'tool.started', {
        'sessionId': 's',
        'turnId': 't',
        'toolCallId': 'a' * 129,
        'toolName': 'bash',
      }),
      event(2, 'tool.started', {
        'sessionId': 's',
        'turnId': 't',
        'toolCallId': 'valid',
      }),
    ]);
    expect(result, isEmpty);
  });

  test('preserves cancelled status without fabricated truncation', () {
    final result = projectRecipeActivities([
      event(1, 'tool.started', {
        'sessionId': 's',
        'turnId': 't',
        'toolCallId': 'a',
        'toolName': 'bash',
      }),
      event(2, 'tool.cancelled', {
        'sessionId': 's',
        'turnId': 't',
        'toolCallId': 'a',
      }),
    ]);
    expect(result.single.status, RecipeActivityStatus.cancelled);
    expect(result.single.truncation, isNull);
  });

  testWidgets('recipe activity is collapsed and expands details', (
    tester,
  ) async {
    final activity = RecipeActivity(
      kind: RecipeActivityKind.tool,
      sessionId: 's',
      turnId: 't',
      activityId: 'a',
      ordinal: 0,
      status: RecipeActivityStatus.completed,
      timing: RecipeTiming(startedAt: DateTime.utc(2026)),
      title: 'read',
      toolName: 'read',
      arguments: '{}',
      output: 'ok',
    );
    await tester.pumpWidget(
      MaterialApp(home: RecipeActivityView(activity: activity)),
    );
    expect(find.text('Arguments: {}'), findsNothing);
    await tester.tap(find.byType(InkWell));
    await tester.pumpAndSettle();
    expect(find.text('Arguments: {}'), findsOneWidget);
  });
}
