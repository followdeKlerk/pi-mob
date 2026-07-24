import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/controls/control_view_data.dart';

void main() {
  test('catalogue entries preserve invocation for draft insertion', () {
    const entry = SupportedCommandData(
      id: 'template:standup',
      title: 'Standup',
      category: SupportedCommandCategory.template,
      invocation: '/standup',
    );
    expect(entry.invocation, '/standup');
    expect(entry.enabled, isTrue);
  });
}
