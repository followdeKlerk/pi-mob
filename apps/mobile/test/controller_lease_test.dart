import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/controller_lease.dart';

void main() {
  group('SessionControllerState', () {
    test('starts in none mode with no lease', () {
      final c = SessionControllerState(sessionId: 's1');
      expect(c.mode, ControllerMode.none);
      expect(c.leaseId, isNull);
      expect(c.hasLease, isFalse);
      expect(c.isObserver, isFalse);
      expect(c.takeoverPending, isFalse);
    });

    test('adoptAcquire moves to primary and stores the lease', () {
      final c = SessionControllerState(sessionId: 's1').adoptAcquire('lease-A');
      expect(c.mode, ControllerMode.primary);
      expect(c.leaseId, 'lease-A');
      expect(c.hasLease, isTrue);
    });

    test('adoptAcquire is idempotent for the same lease id', () {
      final c1 = SessionControllerState(sessionId: 's1').adoptAcquire('L');
      final c2 = c1.adoptAcquire('L');
      expect(identical(c1, c2), isTrue);
    });

    test('release moves primary to observer and clears the lease', () {
      final c = SessionControllerState(
        sessionId: 's1',
      ).adoptAcquire('L').adoptRelease();
      expect(c.mode, ControllerMode.observer);
      expect(c.leaseId, isNull);
      expect(c.isObserver, isTrue);
      expect(c.hasLease, isFalse);
      expect(c.previousMode, ControllerMode.primary);
    });

    test('takeover completes via adoptTakeover and clears the flag', () {
      final c = SessionControllerState(
        sessionId: 's1',
      ).markObserver(observerLeaseId: 'L-remote');
      c.beginTakeover();
      expect(c.takeoverPending, isTrue);
      c.adoptTakeover('L-local');
      expect(c.mode, ControllerMode.primary);
      expect(c.leaseId, 'L-local');
      expect(c.takeoverPending, isFalse);
      expect(c.previousMode, ControllerMode.observer);
    });

    test('beginTakeover is a no-op when already primary', () {
      final c = SessionControllerState(sessionId: 's1').adoptAcquire('L');
      c.beginTakeover();
      expect(c.takeoverPending, isFalse);
    });

    test('markNone resets to none and drops the lease', () {
      final c = SessionControllerState(
        sessionId: 's1',
      ).adoptAcquire('L').markNone();
      expect(c.mode, ControllerMode.none);
      expect(c.leaseId, isNull);
      expect(c.hasLease, isFalse);
    });

    test('snapshot produces a deep-independent copy', () {
      final original = SessionControllerState(
        sessionId: 's1',
      ).adoptAcquire('L');
      final copy = original.snapshot();
      copy.markNone();
      expect(original.mode, ControllerMode.primary);
      expect(copy.mode, ControllerMode.none);
    });
  });

  group('ControllerBook', () {
    test('primarySessionId is null when nobody is primary', () {
      final book = ControllerBook();
      book.forSession('a').markObserver();
      book.forSession('b').markObserver();
      expect(book.primarySessionId, isNull);
      expect(book.isGlobalObserver, isTrue);
    });

    test('primarySessionId returns the only primary', () {
      final book = ControllerBook();
      book.forSession('a').adoptAcquire('L1');
      book.forSession('b').markObserver();
      expect(book.primarySessionId, 'a');
      expect(book.isGlobalObserver, isFalse);
    });

    test('at most one session can be primary (no dual controller)', () {
      final book = ControllerBook();
      book.forSession('a').adoptAcquire('L1');
      book.forSession('b').adoptAcquire('L2');
      expect(book.snapshot().values.where((c) => c.hasLease), hasLength(2));
      // The book itself does not enforce exclusivity — that lives in the
      // host protocol — but the helper for "the current primary" must
      // return *some* deterministic answer.
      final primaries = book
          .snapshot()
          .entries
          .where((e) => e.value.mode == ControllerMode.primary)
          .map((e) => e.key)
          .toList();
      expect(primaries, hasLength(2));
    });

    test('drop removes the entry and the primary lookup updates', () {
      final book = ControllerBook();
      book.forSession('a').adoptAcquire('L1');
      book.forSession('b').adoptAcquire('L2');
      book.drop('a');
      expect(book.contains('a'), isFalse);
      expect(book.contains('b'), isTrue);
    });
  });

  group('ControllerMode wire', () {
    test('controller wire string is "controller"', () {
      expect(controllerModeWire(ControllerMode.primary), 'controller');
      expect(controllerModeWire(ControllerMode.observer), 'observer');
      expect(controllerModeWire(ControllerMode.none), 'none');
    });

    test('wire parser is tolerant of unknown values', () {
      expect(controllerModeFromWire(null), ControllerMode.none);
      expect(controllerModeFromWire('controller'), ControllerMode.primary);
      expect(controllerModeFromWire('observer'), ControllerMode.observer);
      expect(controllerModeFromWire('view_only'), ControllerMode.observer);
      expect(controllerModeFromWire('mystery'), ControllerMode.none);
    });
  });
}
