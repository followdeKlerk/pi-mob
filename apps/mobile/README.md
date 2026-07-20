# pi_mob mobile

Flutter mobile client for pi-mob.

At M2 this package contains the mobile shell and immutable protocol `1.0` discriminated union/validators. Its tests consume the canonical shared corpus from `packages/protocol-fixtures/corpus/` and prove Dart/TypeScript validation, cursor, scenario, round-trip, and semantic-hash parity.

```sh
flutter pub get
flutter analyze
flutter test
```

Connection, persistence, and diagnostic client behavior begin in M5 after the Pi adapter and durable bridge checkpoints are proven.
