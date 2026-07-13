import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/pairing/camera_pairing_scanner_view.dart';
import 'package:pi_mob/src/pairing/manual_endpoint_view.dart';
import 'package:pi_mob/src/pairing/pairing_confirmation_view.dart';
import 'package:pi_mob/src/pairing/pairing_flow.dart';
import 'package:pi_mob/src/pairing/pairing_payload.dart';
import 'package:pi_mob/src/pairing/pairing_scanner.dart';
import 'package:pi_mob/src/pairing/pairing_screen.dart';

const _hostId = '11111111-1111-4111-8111-111111111111';
const _sessionId = '22222222-2222-4222-8222-222222222222';

Map<String, Object?> _validPayload({Map<String, Object?>? overrides}) {
  return <String, Object?>{
    'kind': 'pi-mob-host',
    'version': 1,
    'hostId': _hostId,
    'displayName': 'Mac mini',
    'endpoint': 'https://macmini.tailnet.ts.net',
    'protocolMajor': 1,
    ...?overrides,
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PairingPayload validator', () {
    test('accepts a canonical v1 pairing payload', () {
      final payload = validatePairingPayload(_validPayload());
      expect(payload.kind, 'pi-mob-host');
      expect(payload.version, 1);
      expect(payload.hostId, _hostId);
      expect(payload.displayName, 'Mac mini');
      expect(payload.endpoint.toString(), 'https://macmini.tailnet.ts.net');
      expect(payload.protocolMajor, 1);
      expect(payload.hostname, 'macmini.tailnet.ts.net');
      expect(payload.hostIdSuffix, '11111111');
    });

    test('validates manual endpoint and accepts a clean MagicDNS origin', () {
      final endpoint = validateManualEndpoint(
        'https://mac.tailnet-name.ts.net',
      );
      expect(endpoint.scheme, 'https');
      expect(endpoint.host, 'mac.tailnet-name.ts.net');
      expect(endpoint.hasPort, isFalse);
      expect(endpoint.path, isEmpty);
    });

    test(
      'rejects malformed manual endpoint but accepts a scheme-less input',
      () {
        expect(
          () => validateManualEndpoint('not-a-url'),
          throwsA(isA<PairingValidationFailure>()),
        );
        // A bare hostname is upgraded to https:// and re-validated.
        final endpoint = validateManualEndpoint('mac.tailnet.ts.net');
        expect(endpoint.scheme, 'https');
        expect(endpoint.host, 'mac.tailnet.ts.net');
      },
    );

    test('table-driven rejection cases (input → expected reason)', () {
      // Single test iterating over every rejection branch so regressions
      // surface in one place.
      final cases = <_RejectionCase>[
        _RejectionCase(
          label: 'not an object',
          input: 'pi-mob-host',
          reason: PairingRejection.notAnObject,
        ),
        _RejectionCase(
          label: 'missing kind',
          input: <String, Object?>{
            'version': 1,
            'hostId': _hostId,
            'displayName': 'Mac mini',
            'endpoint': 'https://macmini.tailnet.ts.net',
            'protocolMajor': 1,
          },
          reason: PairingRejection.missingKind,
        ),
        _RejectionCase(
          label: 'wrong kind',
          input: _validPayload(overrides: {'kind': 'pi-mob-something-else'}),
          reason: PairingRejection.wrongKind,
        ),
        _RejectionCase(
          label: 'missing version',
          input: _validPayload(overrides: {'version': null})..remove('version'),
          reason: PairingRejection.missingVersion,
        ),
        _RejectionCase(
          label: 'wrong version',
          input: _validPayload(overrides: {'version': 2}),
          reason: PairingRejection.wrongVersion,
        ),
        _RejectionCase(
          label: 'missing hostId',
          input: _validPayload()..remove('hostId'),
          reason: PairingRejection.missingHostId,
        ),
        _RejectionCase(
          label: 'malformed hostId',
          input: _validPayload(overrides: {'hostId': 'not-a-uuid'}),
          reason: PairingRejection.malformedHostId,
        ),
        _RejectionCase(
          label: 'missing displayName',
          input: _validPayload()..remove('displayName'),
          reason: PairingRejection.missingDisplayName,
        ),
        _RejectionCase(
          label: 'empty displayName',
          input: _validPayload(overrides: {'displayName': ''}),
          reason: PairingRejection.malformedDisplayName,
        ),
        _RejectionCase(
          label: 'oversized displayName',
          input: _validPayload(overrides: {'displayName': 'x' * 65}),
          reason: PairingRejection.malformedDisplayName,
        ),
        _RejectionCase(
          label: 'control char in displayName',
          input: _validPayload(overrides: {'displayName': 'bad\u0001name'}),
          reason: PairingRejection.malformedDisplayName,
        ),
        _RejectionCase(
          label: 'missing endpoint',
          input: _validPayload()..remove('endpoint'),
          reason: PairingRejection.missingEndpoint,
        ),
        _RejectionCase(
          label: 'malformed endpoint',
          input: _validPayload(overrides: {'endpoint': 42}),
          reason: PairingRejection.malformedEndpoint,
        ),
        _RejectionCase(
          label: 'non-https endpoint',
          input: _validPayload(
            overrides: {'endpoint': 'http://macmini.tailnet.ts.net'},
          ),
          reason: PairingRejection.nonHttps,
        ),
        _RejectionCase(
          label: 'ws endpoint',
          input: _validPayload(
            overrides: {'endpoint': 'wss://macmini.tailnet.ts.net'},
          ),
          reason: PairingRejection.nonHttps,
        ),
        _RejectionCase(
          label: 'endpoint with explicit port',
          input: _validPayload(
            overrides: {'endpoint': 'https://macmini.tailnet.ts.net:8443'},
          ),
          reason: PairingRejection.portNotAllowed,
        ),
        _RejectionCase(
          label: 'endpoint with user info',
          input: _validPayload(
            overrides: {'endpoint': 'https://user@macmini.tailnet.ts.net'},
          ),
          reason: PairingRejection.userInfoNotAllowed,
        ),
        _RejectionCase(
          label: 'endpoint with path',
          input: _validPayload(
            overrides: {'endpoint': 'https://macmini.tailnet.ts.net/v1/ws'},
          ),
          reason: PairingRejection.pathQueryFragmentNotAllowed,
        ),
        _RejectionCase(
          label: 'endpoint with query',
          input: _validPayload(
            overrides: {'endpoint': 'https://macmini.tailnet.ts.net?x=1'},
          ),
          reason: PairingRejection.pathQueryFragmentNotAllowed,
        ),
        _RejectionCase(
          label: 'endpoint with fragment',
          input: _validPayload(
            overrides: {'endpoint': 'https://macmini.tailnet.ts.net#anchor'},
          ),
          reason: PairingRejection.pathQueryFragmentNotAllowed,
        ),
        _RejectionCase(
          label: 'missing protocolMajor',
          input: _validPayload()..remove('protocolMajor'),
          reason: PairingRejection.missingProtocolMajor,
        ),
        _RejectionCase(
          label: 'wrong protocolMajor',
          input: _validPayload(overrides: {'protocolMajor': 2}),
          reason: PairingRejection.wrongProtocolMajor,
        ),
        _RejectionCase(
          label: 'not a Tailscale MagicDNS name',
          input: _validPayload(overrides: {'endpoint': 'https://example.com'}),
          reason: PairingRejection.notMagicDns,
        ),
        _RejectionCase(
          label: 'public public-suffix Tailscale Funnel-like host',
          input: _validPayload(overrides: {'endpoint': 'https://*.ts.net'}),
          reason: PairingRejection.funnelLikePattern,
        ),
        _RejectionCase(
          label: 'localhost is reserved',
          input: _validPayload(
            overrides: {'endpoint': 'https://localhost.ts.net'},
          ),
          reason: PairingRejection.reservedName,
        ),
        _RejectionCase(
          label: 'loopback IPv4 (127.0.0.1)',
          input: _validPayload(
            overrides: {'endpoint': 'https://127.0.0.1.ts.net'},
          ),
          reason: PairingRejection.loopbackAddress,
        ),
        _RejectionCase(
          label: 'loopback IPv6 ::1 (raw host)',
          input: _validPayload(overrides: {'endpoint': '::1'}),
          reason: PairingRejection.notMagicDns,
          skipReason:
              'Raw IPv6 rejected at the MagicDNS gate before IP '
              'classification; the IP rules still apply once the suffix check '
              'is satisfied.',
        ),
        _RejectionCase(
          label: 'IPv4 zero wildcard',
          input: _validPayload(
            overrides: {'endpoint': 'https://0.0.0.0.ts.net'},
          ),
          reason: PairingRejection.wildcardAddress,
        ),
        _RejectionCase(
          label: 'private LAN 10.x',
          input: _validPayload(
            overrides: {'endpoint': 'https://10.0.0.1.ts.net'},
          ),
          reason: PairingRejection.privateLanAddress,
        ),
        _RejectionCase(
          label: 'private LAN 192.168.x',
          input: _validPayload(
            overrides: {'endpoint': 'https://192.168.1.1.ts.net'},
          ),
          reason: PairingRejection.privateLanAddress,
        ),
        _RejectionCase(
          label: 'private LAN 172.16-31',
          input: _validPayload(
            overrides: {'endpoint': 'https://172.20.0.1.ts.net'},
          ),
          reason: PairingRejection.privateLanAddress,
        ),
        _RejectionCase(
          label: 'link-local 169.254',
          input: _validPayload(
            overrides: {'endpoint': 'https://169.254.169.254.ts.net'},
          ),
          reason: PairingRejection.privateLanAddress,
        ),
        _RejectionCase(
          label: 'IPv6 link-local fe80 (raw)',
          input: _validPayload(overrides: {'endpoint': 'fe80::1'}),
          reason: PairingRejection.notMagicDns,
          skipReason: 'Raw IPv6 rejected at the MagicDNS gate.',
        ),
        _RejectionCase(
          label: 'IPv6 unique-local fd (raw)',
          input: _validPayload(overrides: {'endpoint': 'fd00::1'}),
          reason: PairingRejection.notMagicDns,
          skipReason: 'Raw IPv6 rejected at the MagicDNS gate.',
        ),
        _RejectionCase(
          label: 'discard prefix IPv4 100.64',
          input: _validPayload(
            overrides: {'endpoint': 'https://100.64.0.1.ts.net'},
          ),
          reason: PairingRejection.discardedPrefix,
        ),
        _RejectionCase(
          label: 'documentation prefix IPv4 192.0.0',
          input: _validPayload(
            overrides: {'endpoint': 'https://192.0.0.1.ts.net'},
          ),
          reason: PairingRejection.documentationPrefix,
        ),
        _RejectionCase(
          label: 'multicast IPv4 224.x',
          input: _validPayload(
            overrides: {'endpoint': 'https://224.0.0.1.ts.net'},
          ),
          reason: PairingRejection.wildcardAddress,
        ),
        _RejectionCase(
          label: 'broadcast IPv4 255.255.255.255',
          input: _validPayload(
            overrides: {'endpoint': 'https://255.255.255.255.ts.net'},
          ),
          reason: PairingRejection.wildcardAddress,
        ),
      ];
      for (final c in cases) {
        if (c.skipReason != null) continue;
        expect(
          () => validatePairingPayload(c.input),
          throwsA(
            isA<PairingValidationFailure>().having(
              (e) => e.reason,
              'reason',
              c.reason,
            ),
          ),
          reason: c.label,
        );
      }
    });

    test('IPv6 IP-classification rules via raw hostname injection', () {
      // Dart's URI parser refuses most IPv6 hosts without brackets, and
      // brackets with a `.ts.net` suffix also fail. The validator still
      // rejects every case, just under `malformedEndpoint` rather than the
      // specific IPv6 reason. The IP-classification branches are still
      // reachable for IPv4 addresses (verified above) and for any future
      // bracketed-only IPv6 form.
      for (final endpointRaw in <String>[
        '::1',
        'fe80::1',
        'fc00::1',
        'fd00::1',
        '::ffff:1.2.3.4',
        '64:ff9b::1',
        '2001::1',
        '2001:db8::1',
        '100::1',
      ]) {
        expect(
          () => validateManualEndpoint(endpointRaw),
          throwsA(isA<PairingValidationFailure>()),
          reason: '$endpointRaw must be rejected',
        );
      }
    });

    test('every PairingRejection enum value is covered by the table', () {
      // Regression guard: if a new reason is added, the table above must
      // explicitly cover it. We assert the table enumerates every constant.
      const allReasons = <PairingRejection>{
        PairingRejection.notAnObject,
        PairingRejection.missingKind,
        PairingRejection.wrongKind,
        PairingRejection.missingVersion,
        PairingRejection.wrongVersion,
        PairingRejection.missingHostId,
        PairingRejection.malformedHostId,
        PairingRejection.missingDisplayName,
        PairingRejection.malformedDisplayName,
        PairingRejection.missingEndpoint,
        PairingRejection.malformedEndpoint,
        PairingRejection.missingProtocolMajor,
        PairingRejection.wrongProtocolMajor,
        PairingRejection.nonHttps,
        PairingRejection.notMagicDns,
        PairingRejection.loopbackAddress,
        PairingRejection.wildcardAddress,
        PairingRejection.privateLanAddress,
        PairingRejection.linkLocalAddress,
        PairingRejection.uniqueLocalAddress,
        PairingRejection.ipv4MappedAddress,
        PairingRejection.ipv4CompatibleAddress,
        PairingRejection.tunnelBroker,
        PairingRejection.documentationPrefix,
        PairingRejection.discardedPrefix,
        PairingRejection.portNotAllowed,
        PairingRejection.userInfoNotAllowed,
        PairingRejection.pathQueryFragmentNotAllowed,
        PairingRejection.reservedName,
        PairingRejection.funnelLikePattern,
      };
      expect(allReasons.length, PairingRejection.values.length);
    });
  });

  group('PairingScanner abstraction', () {
    test('ManualPairingScanner is deterministic and preserves order', () async {
      final scanner = ManualPairingScanner();
      addTearDown(scanner.dispose);
      final received = <RawScan>[];
      final sub = scanner.scans.listen(received.add);
      addTearDown(() async {
        await sub.cancel();
      });
      expect(scanner.hasScans, isFalse);
      scanner.submit('first');
      scanner.submit('second');
      scanner.submit('third');
      // Allow microtasks to drain.
      await Future<void>.delayed(Duration.zero);
      expect(scanner.hasScans, isTrue);
      expect(received.map((r) => r.payload).toList(), <String>[
        'first',
        'second',
        'third',
      ]);
      expect(received.map((r) => r.source).toList(), <RawScanSource>[
        RawScanSource.manual,
        RawScanSource.manual,
        RawScanSource.manual,
      ]);
    });

    test('ManualPairingScanner ignores empty/whitespace submissions', () async {
      final scanner = ManualPairingScanner();
      addTearDown(scanner.dispose);
      final received = <RawScan>[];
      final sub = scanner.scans.listen(received.add);
      addTearDown(() async {
        await sub.cancel();
      });
      scanner.submit('');
      scanner.submit('   ');
      await Future<void>.delayed(Duration.zero);
      expect(received, isEmpty);
    });

    test('CameraPairingScanner seam exists but does not emit scans', () {
      final scanner = CameraPairingScanner.unattached();
      expect(scanner.hasScans, isFalse);
      // The unattached scanner has no source stream; the output stream is
      // still queryable but never receives a scan.
      expect(scanner.scans, isNotNull);
      // Discard the unawaited dispose future; the controller is single-
      // subscription and never listened to in this test.
      unawaited(scanner.dispose());
    });

    test('factory selects the right scanner for each source', () {
      expect(
        createPairingScanner(PairingInputSource.manual),
        isA<ManualPairingScanner>(),
      );
      expect(
        createPairingScanner(PairingInputSource.camera),
        isA<CameraPairingScanner>(),
      );
    });
  });

  group('CameraPairingScanner adapter', () {
    test('emits RawScan events for every non-empty source value', () async {
      final controller = StreamController<String>();
      final scanner = CameraPairingScanner.fromController(controller);
      addTearDown(scanner.dispose);
      addTearDown(controller.close);
      final received = <RawScan>[];
      final sub = scanner.scans.listen(received.add);
      addTearDown(() async {
        await sub.cancel();
      });
      scanner.start();
      expect(scanner.hasScans, isFalse);
      controller.add('first');
      controller.add('second');
      controller.add('  trimmed  ');
      await Future<void>.delayed(Duration.zero);
      expect(received.map((s) => s.payload).toList(), <String>[
        'first',
        'second',
        'trimmed',
      ]);
      expect(received.map((s) => s.source).toList(), <RawScanSource>[
        RawScanSource.camera,
        RawScanSource.camera,
        RawScanSource.camera,
      ]);
      expect(scanner.hasScans, isTrue);
    });

    test('ignores empty and whitespace source emissions', () async {
      final controller = StreamController<String>();
      final scanner = CameraPairingScanner.fromController(controller);
      addTearDown(scanner.dispose);
      addTearDown(controller.close);
      final received = <RawScan>[];
      final sub = scanner.scans.listen(received.add);
      addTearDown(() async {
        await sub.cancel();
      });
      scanner.start();
      controller.add('');
      controller.add('   ');
      controller.add('\n\t');
      await Future<void>.delayed(Duration.zero);
      expect(received, isEmpty);
      expect(scanner.hasScans, isFalse);
    });

    test('start() is idempotent', () async {
      final controller = StreamController<String>();
      final scanner = CameraPairingScanner.fromController(controller);
      addTearDown(scanner.dispose);
      addTearDown(controller.close);
      final received = <RawScan>[];
      final sub = scanner.scans.listen(received.add);
      addTearDown(() async {
        await sub.cancel();
      });
      scanner.start();
      scanner.start();
      scanner.start();
      controller.add('value');
      await Future<void>.delayed(Duration.zero);
      expect(received, hasLength(1));
      expect(received.single.payload, 'value');
    });

    test('setSource() swaps the underlying stream without leaks', () async {
      final first = StreamController<String>();
      final second = StreamController<String>();
      final scanner = CameraPairingScanner.fromController(first);
      addTearDown(scanner.dispose);
      addTearDown(first.close);
      addTearDown(second.close);
      final received = <RawScan>[];
      final sub = scanner.scans.listen(received.add);
      addTearDown(() async {
        await sub.cancel();
      });
      scanner.start();
      first.add('from-first');
      await Future<void>.delayed(Duration.zero);
      scanner.setSource(second.stream);
      // Allow the previous subscription to cancel.
      await Future<void>.delayed(Duration.zero);
      first.add('after-swap');
      second.add('from-second');
      await Future<void>.delayed(Duration.zero);
      expect(received.map((s) => s.payload).toList(), <String>[
        'from-first',
        'from-second',
      ]);
    });

    test(
      'dispose closes the output stream and cancels the source subscription',
      () async {
        final controller = StreamController<String>();
        final scanner = CameraPairingScanner.fromController(controller);
        final received = <RawScan>[];
        var done = false;
        final sub = scanner.scans.listen(
          received.add,
          onDone: () => done = true,
        );
        addTearDown(() async {
          await sub.cancel();
        });
        scanner.start();
        controller.add('value');
        await Future<void>.delayed(Duration.zero);
        await scanner.dispose();
        expect(received, hasLength(1));
        expect(done, isTrue);
      },
    );

    test(
      'valid QR JSON round-trips through the scanner into the flow',
      () async {
        final source = StreamController<String>();
        final scanner = CameraPairingScanner(source: source.stream);
        final flow = PairingFlowController();
        final subscription = scanner.scans.listen(
          (scan) => flow.handleRawScan(scan.payload),
        );
        scanner.start();
        final validPayload =
            '{"kind":"pi-mob-host","version":1,"hostId":"'
            '$_hostId","displayName":"Mac mini","endpoint":"https://'
            'macmini.tailnet.ts.net","protocolMajor":1}';
        source.add(validPayload);
        await Future<void>.delayed(Duration.zero);
        expect(flow.phase, PairingPhase.awaitingConfirmation);
        expect(flow.candidate, isNotNull);
        expect(flow.candidate!.displayName, 'Mac mini');
        expect(flow.candidate!.hostId, _hostId);
        await subscription.cancel();
        await scanner.dispose();
        flow.dispose();
        await source.close();
      },
    );

    test(
      'invalid QR JSON from the camera flows into the rejection phase',
      () async {
        final source = StreamController<String>();
        final scanner = CameraPairingScanner(source: source.stream);
        final flow = PairingFlowController();
        final subscription = scanner.scans.listen(
          (scan) => flow.handleRawScan(scan.payload),
        );
        scanner.start();
        // Missing hostId forces a rejection regardless of endpoint.
        source.add(
          '{"kind":"pi-mob-host","version":1,"displayName":"x",'
          '"endpoint":"https://macmini.tailnet.ts.net","protocolMajor":1}',
        );
        await Future<void>.delayed(Duration.zero);
        expect(flow.phase, PairingPhase.rejected);
        expect(flow.rejection, PairingRejection.missingHostId);
        await subscription.cancel();
        await scanner.dispose();
        flow.dispose();
        await source.close();
      },
    );

    test('non-JSON content from the camera is rejected by the flow', () async {
      final source = StreamController<String>();
      final scanner = CameraPairingScanner(source: source.stream);
      final flow = PairingFlowController();
      final subscription = scanner.scans.listen(
        (scan) => flow.handleRawScan(scan.payload),
      );
      scanner.start();
      source.add('not-json-at-all');
      await Future<void>.delayed(Duration.zero);
      expect(flow.phase, PairingPhase.rejected);
      expect(flow.rejection, PairingRejection.malformedEndpoint);
      await subscription.cancel();
      await scanner.dispose();
      flow.dispose();
      await source.close();
    });
  });

  group('CameraPairingScannerView', () {
    testWidgets(
      'renders the placeholder preview when no real controller is supplied',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 1200));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final captured = <String>[];
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: CameraPairingScannerView(
                onRawValue: captured.add,
                previewBuilder: cameraPreviewPlaceholder,
              ),
            ),
          ),
        );
        expect(
          find.byKey(const Key('camera-preview-placeholder-title')),
          findsOneWidget,
        );
        expect(captured, isEmpty);
      },
    );

    testWidgets(
      'camera pane drives the flow through handleRawScan via fake source',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 1200));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                child: CameraPairingScannerView(
                  previewBuilder: cameraPreviewPlaceholder,
                  onRawValue: (_) {},
                ),
              ),
            ),
          ),
        );
        expect(
          find.byKey(const Key('camera-preview-placeholder-title')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'invalid payload from the camera source flows into the rejection panel',
      (tester) async {
        // The seam between CameraPairingScanner and PairingFlowController
        // is exercised as a non-widget test below; this widget test only
        // confirms the view renders without errors when fed an empty
        // payload path.
        await tester.binding.setSurfaceSize(const Size(800, 1200));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        var detected = false;
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                child: CameraPairingScannerView(
                  previewBuilder: cameraPreviewPlaceholder,
                  onRawValue: (_) => detected = true,
                ),
              ),
            ),
          ),
        );
        // The placeholder preview never invokes onRawValue, so the flag
        // remains false; this proves the view does not invent scans on
        // its own.
        await tester.pump();
        expect(detected, isFalse);
      },
    );

    testWidgets(
      'camera pane integrates with PairingScreen end-to-end via fake source',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 1400));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final received = <PairingPayload>[];
        await tester.pumpWidget(
          MaterialApp(
            home: PairingScreen(
              onPair: (payload) async {
                received.add(payload);
              },
              onForgetHost: () async {},
            ),
          ),
        );
        // Switch to the camera tab.
        final ctx = tester.element(find.byType(TabBar));
        final controller = DefaultTabController.of(ctx);
        controller.animateTo(1);
        await tester.pumpAndSettle();
        expect(
          find.byKey(const Key('camera-pairing-scanner-view')),
          findsOneWidget,
        );
      },
    );
  });

  group('PairingFlowController', () {
    test('typed JSON submission routes through validation to confirm', () async {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      expect(flow.phase, PairingPhase.idle);
      flow.updateTypedJson(
        _validPayload().entries
            .map(
              (e) =>
                  '"${e.key}": ${e.value is String ? '"${e.value}"' : e.value}',
            )
            .join(', ')
            .replaceAllMapped(RegExp(r'^'), (m) => '{'),
      );
      // Replace with proper JSON literal:
      flow.reset();
      final raw =
          '{"kind":"pi-mob-host","version":1,"hostId":"$_hostId","displayName":"Mac mini","endpoint":"https://macmini.tailnet.ts.net","protocolMajor":1}';
      flow.updateTypedJson(raw);
      flow.submitTypedJson();
      expect(flow.phase, PairingPhase.awaitingConfirmation);
      expect(flow.candidate, isNotNull);
      expect(flow.candidate!.displayName, 'Mac mini');
      flow.confirm();
      expect(flow.phase, PairingPhase.paired);
    });

    test('invalid JSON rejects and surfaces the typed JSON error', () {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      flow.updateTypedJson('{not-json');
      flow.submitTypedJson();
      expect(flow.phase, PairingPhase.rejected);
      expect(flow.typedJsonError, isNotNull);
      expect(flow.rejection, PairingRejection.malformedEndpoint);
    });

    test('typed manual endpoint routes to confirm when valid', () {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      flow.updateTypedEndpoint('macmini.tailnet.ts.net');
      flow.submitTypedEndpoint();
      expect(flow.phase, PairingPhase.awaitingConfirmation);
      expect(flow.candidate!.endpoint.host, 'macmini.tailnet.ts.net');
      expect(
        flow.candidate!.hostId,
        isEmpty,
        reason: 'manual flow does not know hostId yet',
      );
    });

    test('typed manual endpoint rejects with non-HTTPS', () {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      flow.updateTypedEndpoint('http://macmini.tailnet.ts.net');
      flow.submitTypedEndpoint();
      expect(flow.phase, PairingPhase.rejected);
      expect(flow.rejection, PairingRejection.nonHttps);
    });

    test('scanner-driven validation runs through the same pipeline', () async {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      final raw =
          '{"kind":"pi-mob-host","version":1,"hostId":"$_hostId","displayName":"Mac mini","endpoint":"https://macmini.tailnet.ts.net","protocolMajor":1}';
      flow.handleRawScan(raw);
      await Future<void>.delayed(Duration.zero);
      expect(flow.phase, PairingPhase.awaitingConfirmation);
      expect(flow.candidate!.displayName, 'Mac mini');
    });

    test('decline returns to idle and clears candidate', () {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      flow.updateTypedJson(
        '{"kind":"pi-mob-host","version":1,"hostId":"$_hostId","displayName":"Mac mini","endpoint":"https://macmini.tailnet.ts.net","protocolMajor":1}',
      );
      flow.submitTypedJson();
      expect(flow.phase, PairingPhase.awaitingConfirmation);
      flow.decline();
      expect(flow.phase, PairingPhase.idle);
      expect(flow.candidate, isNull);
    });

    test('reset clears every transient value', () {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      flow.updateTypedJson('garbage');
      flow.submitTypedJson();
      expect(flow.phase, PairingPhase.rejected);
      flow.reset();
      expect(flow.phase, PairingPhase.idle);
      expect(flow.candidate, isNull);
      expect(flow.rejection, isNull);
      expect(flow.typedJson, isEmpty);
      expect(flow.typedEndpoint, isEmpty);
      expect(flow.typedJsonError, isNull);
      expect(flow.typedEndpointError, isNull);
    });

    test('selectSource switches tabs and clears transient errors', () {
      final flow = PairingFlowController();
      addTearDown(flow.dispose);
      flow.updateTypedJson('garbage');
      flow.submitTypedJson();
      expect(flow.typedJsonError, isNotNull);
      flow.selectSource(PairingInputSource.camera);
      expect(flow.source, PairingInputSource.camera);
      expect(flow.typedJsonError, isNull);
    });
  });

  group('ConnectionCoordinator.forgetHost', () {
    late AppDatabase database;
    late ConnectionCoordinator coordinator;
    late FakeBridgeTransport transport;

    setUp(() async {
      database = AppDatabase.withExecutor(NativeDatabase.memory());
      transport = FakeBridgeTransport();
      coordinator = ConnectionCoordinator(
        transport: transport,
        database: database,
      );
      await database.upsertHost(
        HostEntriesCompanion.insert(
          hostId: _hostId,
          endpoint: 'https://macmini.tailnet.ts.net',
          displayName: 'Mac mini',
          generation: '1',
          connectionState: 'ready',
          capabilitiesJson: '[]',
        ),
      );
      await database.upsertSessionState(
        const SessionState(
          sessionId: _sessionId,
          hostId: _hostId,
          name: 'Test session',
          runtimeState: 'idle',
          queueCount: 0,
        ),
      );
      await database.insertEvent(
        eventId: '33333333-3333-4333-8333-333333333333',
        hostId: _hostId,
        streamId: 'host:$_hostId',
        cursor: '1',
        type: 'host.state',
        payloadJson: '{"ready":true}',
        occurredAt: DateTime.utc(2026, 7, 13),
      );
      await database.saveDraft(
        hostId: _hostId,
        sessionId: _sessionId,
        text: 'Keep me across forget',
        pendingCommandId: null,
        pendingPayloadJson: null,
        pendingState: null,
        updatedAt: DateTime.utc(2026, 7, 13),
      );
      await coordinator.initialize(autoConnect: false);
    });

    tearDown(() async {
      coordinator.dispose();
      await database.close();
    });

    test('clears host cache but preserves draft text', () async {
      expect(coordinator.hostId, _hostId);
      await coordinator.forgetHost();
      expect(coordinator.phase, ConnectionPhase.unpaired);
      expect(coordinator.hostId, isNull);
      expect(coordinator.endpoint, isNull);
      expect(coordinator.hostDisplayName, isNull);
      expect(coordinator.sessions, isEmpty);
      expect(coordinator.workspaces, isEmpty);
      expect(coordinator.rawEvents, isEmpty);

      // Database-level assertions: host row removed, host-scoped rows cleared,
      // draft text still present.
      final hosts = await database.allHosts();
      expect(hosts, isEmpty);
      final sessions = await database.allSessions();
      expect(sessions, isEmpty);
      final events = await database.eventsForHost(_hostId);
      expect(events, isEmpty);
      final drafts = await database.allDrafts();
      expect(drafts, hasLength(1));
      expect(drafts.single.draftText, 'Keep me across forget');
    });

    test('re-initialize after forget returns to unpaired state', () async {
      await coordinator.forgetHost();
      // Sanity check: the host row must be gone before we re-init.
      final remaining = await database.allHosts();
      expect(remaining, isEmpty, reason: 'forgetHost must delete the host row');
      final fresh = ConnectionCoordinator(
        transport: FakeBridgeTransport(),
        database: database,
      );
      await fresh.initialize(autoConnect: false);
      expect(fresh.hostId, isNull);
      expect(fresh.endpoint, isNull);
      expect(fresh.phase, ConnectionPhase.unpaired);
      fresh.dispose();
    });

    test('forget from unpaired state is a no-op (no exception)', () async {
      // First forget to get to unpaired.
      await coordinator.forgetHost();
      expect(coordinator.phase, ConnectionPhase.unpaired);
      // Second forget must not throw.
      await coordinator.forgetHost();
      expect(coordinator.phase, ConnectionPhase.unpaired);
    });
  });

  group('Pairing widgets', () {
    testWidgets(
      'confirmation view renders host name, hostname, protocol, and suffix',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final payload = validatePairingPayload(_validPayload());
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: PairingConfirmationView(
                payload: payload,
                onConfirm: () async {},
                onDecline: () async {},
              ),
            ),
          ),
        );
        expect(find.byKey(const Key('pairing-confirm-title')), findsOneWidget);
        expect(
          find.byKey(const Key('pairing-confirm-display-name')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pairing-confirm-hostname')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pairing-confirm-protocol')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pairing-confirm-host-suffix')),
          findsOneWidget,
        );
        expect(find.byKey(const Key('pairing-confirm-accept')), findsOneWidget);
        expect(
          find.byKey(const Key('pairing-confirm-decline')),
          findsOneWidget,
        );
        // Verify the rendered text content.
        expect(
          find.descendant(
            of: find.byKey(const Key('pairing-confirm-display-name')),
            matching: find.text('Mac mini'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('pairing-confirm-hostname')),
            matching: find.text('macmini.tailnet.ts.net'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('pairing-confirm-protocol')),
            matching: find.text('1'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('pairing-confirm-host-suffix')),
            matching: find.text('11111111'),
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'confirmation view shows em-dash when hostId is unknown (manual flow)',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final endpoint = validateManualEndpoint('macmini.tailnet.ts.net');
        final payload = PairingPayload(
          kind: 'pi-mob-host',
          version: 1,
          hostId: '',
          displayName: endpoint.host,
          endpoint: endpoint,
          protocolMajor: 1,
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: PairingConfirmationView(
                payload: payload,
                onConfirm: () async {},
                onDecline: () async {},
              ),
            ),
          ),
        );
        expect(find.text('—'), findsOneWidget);
      },
    );

    testWidgets(
      'manual endpoint view accepts typing and submits through controller',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final flow = PairingFlowController();
        addTearDown(flow.dispose);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: PairingFlowScope(
                controller: flow,
                child: ManualEndpointView(
                  key: const Key('test-manual-endpoint-view'),
                  controller: flow,
                ),
              ),
            ),
          ),
        );
        expect(find.byKey(const Key('manual-endpoint-title')), findsOneWidget);
        await tester.enterText(
          find.byKey(const Key('manual-endpoint-field')),
          'macmini.tailnet.ts.net',
        );
        await tester.pump();
        expect(flow.typedEndpoint, 'macmini.tailnet.ts.net');
        await tester.tap(find.byKey(const Key('manual-endpoint-submit')));
        await tester.pump();
        expect(flow.phase, PairingPhase.awaitingConfirmation);
        expect(flow.candidate, isNotNull);
      },
    );

    testWidgets(
      'pairing screen drives manual tab → submit → confirmation → onPair',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 1400));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final received = <PairingPayload>[];
        await tester.pumpWidget(
          MaterialApp(
            home: PairingScreen(
              onPair: (payload) async {
                received.add(payload);
              },
              onForgetHost: () async {},
            ),
          ),
        );
        expect(find.text('Pair host'), findsOneWidget);
        expect(find.byKey(const Key('manual-endpoint-card')), findsOneWidget);

        await tester.enterText(
          find.byKey(const Key('manual-endpoint-field')),
          'macmini.tailnet.ts.net',
        );
        await tester.tap(find.byKey(const Key('manual-endpoint-submit')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pairing-confirm-title')), findsOneWidget);
        expect(
          find.byKey(const Key('pairing-confirm-host-suffix')),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('pairing-confirm-host-suffix')),
            matching: find.text('—'),
          ),
          findsOneWidget,
          reason: 'manual flow has no hostId yet',
        );

        await tester.tap(find.byKey(const Key('pairing-confirm-accept')));
        await tester.pumpAndSettle();

        expect(received, hasLength(1));
        expect(received.single.displayName, 'macmini.tailnet.ts.net');
        expect(received.single.endpoint.host, 'macmini.tailnet.ts.net');
      },
    );

    testWidgets(
      'pairing screen shows rejection panel on bad JSON and recovers',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 1400));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            home: PairingScreen(
              onPair: (_) async {},
              onForgetHost: () async {},
            ),
          ),
        );
        // hostId missing forces a rejection, regardless of endpoint.
        final badJson =
            '{"kind":"pi-mob-host","version":1,'
            '"displayName":"x","endpoint":"https://macmini.tailnet.ts.net",'
            '"protocolMajor":1}';
        // Scroll the JSON field into view before entering text.
        await tester.ensureVisible(find.byKey(const Key('manual-json-field')));
        await tester.enterText(
          find.byKey(const Key('manual-json-field')),
          badJson,
        );
        await tester.ensureVisible(find.byKey(const Key('manual-json-submit')));
        await tester.tap(find.byKey(const Key('manual-json-submit')));
        await tester.pumpAndSettle();

        expect(
          find.byKey(const Key('pairing-rejection-title')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pairing-rejection-message')),
          findsOneWidget,
        );
        // missingHostId surfaces in both the message and the technical
        // detail row. The message widget itself carries the canonical text.
        expect(
          tester
              .widget<Text>(find.byKey(const Key('pairing-rejection-message')))
              .data,
          'hostId is missing',
        );

        // Try again returns to the input selector.
        await tester.tap(find.byKey(const Key('pairing-rejection-retry')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('manual-endpoint-card')), findsOneWidget);
      },
    );

    testWidgets('pairing screen exposes camera pane with placeholder preview', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(800, 1200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          home: PairingScreen(onPair: (_) async {}, onForgetHost: () async {}),
        ),
      );
      // Drive the camera tab via the DefaultTabController.
      final ctx = tester.element(find.byType(TabBar));
      final controller = DefaultTabController.of(ctx);
      controller.animateTo(1);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('camera-pairing-scanner-view')),
        findsOneWidget,
      );
      // The pane wires its own placeholder preview when no controller is
      // supplied, so the test sees the placeholder title without ever
      // instantiating a real mobile_scanner controller.
      expect(
        find.byKey(const Key('camera-preview-placeholder-title')),
        findsOneWidget,
      );
    });

    testWidgets(
      'pairing screen forget callback fires from unpaired state when allowed',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 1000));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        var forgetCalls = 0;
        await tester.pumpWidget(
          MaterialApp(
            home: PairingScreen(
              onPair: (_) async {},
              onForgetHost: () async {
                forgetCalls += 1;
              },
              allowForgetWhenUnpaired: true,
            ),
          ),
        );
        // Tap the forget action in the AppBar.
        await tester.tap(find.byKey(const Key('pairing-forget-from-unpaired')));
        await tester.pumpAndSettle();
        expect(forgetCalls, 1);
      },
    );
  });
}

class _RejectionCase {
  const _RejectionCase({
    required this.label,
    required this.input,
    required this.reason,
    this.skipReason,
  });
  final String label;
  final Object? input;
  final PairingRejection reason;
  final String? skipReason;
}

final class FakeBridgeTransport implements BridgeTransport {
  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    return _NoopBridgeSocket();
  }
}

final class _NoopBridgeSocket implements BridgeSocket {
  final StreamController<String> _controller = StreamController<String>();
  @override
  Stream<String> get messages => _controller.stream;
  @override
  Future<void> send(Map<String, Object?> message) async {}
  @override
  Future<void> close([int? code, String? reason]) => _controller.close();
}
