# @pi-mob/protocol-fixtures

Reserved protocol fixture corpus. M1 ships the valid/invalid `hello`
envelope pair that Dart and TypeScript both decode. M2 expands the
corpus to every declared command/event/response/error plus boundary,
replay, lease, idempotency, queue, attachment, export, and dialog
fixtures. The Flutter app's `immutable protocol fixture decoder test`
lives at `apps/mobile/test/protocol_fixture_test.dart` and consumes the
same JSON file.
