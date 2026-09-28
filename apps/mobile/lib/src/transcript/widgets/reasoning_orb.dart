/// Native thinking-orb canvas and public activity mapping.
///
/// The geometry follows the MIT-licensed Jakub Antalik thinking-orbs
/// vocabulary: tilted particle orbits, globe/rubik/wave lattices, a connected
/// web, braid strands, and ribbon/ring/morph presets. It deliberately renders
/// public activity only; it never receives or displays model reasoning text.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../domain/prompt_send_lifecycle.dart';

/// The visual modes from the upstream thinking-orbs preset registry.
enum OrbMode { orbits, globe, rubik, wave, web, braid, ribbon, ring, morph }

/// Public activity used to select one concise label and one orb mode.
@immutable
class OrbActivity {
  const OrbActivity({required this.label, required this.mode});

  final String label;
  final OrbMode mode;

  @override
  bool operator ==(Object other) =>
      other is OrbActivity && other.label == label && other.mode == mode;

  @override
  int get hashCode => Object.hash(label, mode);
}

/// Maps public tool and turn status to the upstream-inspired mode vocabulary.
/// Tool names are intentionally the only detail exposed from tool activity.
OrbActivity orbActivityFor({
  required PromptSendStatus status,
  required String? runtimeState,
  required String? activeToolName,
}) {
  final tool = activeToolName?.trim().toLowerCase();
  if (tool != null && tool.isNotEmpty) {
    switch (tool) {
      case 'read':
        return const OrbActivity(label: 'Read', mode: OrbMode.globe);
      case 'grep':
      case 'ffgrep':
      case 'find':
      case 'search':
        return const OrbActivity(label: 'Search', mode: OrbMode.globe);
      case 'write':
      case 'edit':
      case 'apply_patch':
        return const OrbActivity(label: 'Write', mode: OrbMode.ribbon);
      case 'bash':
      case 'shell':
      case 'exec':
        return const OrbActivity(label: 'Run', mode: OrbMode.rubik);
      case 'fetch':
      case 'browser':
        return const OrbActivity(label: 'Browse', mode: OrbMode.web);
      case 'subagent':
        return const OrbActivity(label: 'Delegate', mode: OrbMode.braid);
      default:
        return const OrbActivity(label: 'Working', mode: OrbMode.orbits);
    }
  }
  if (runtimeState == 'waiting_for_input') {
    return const OrbActivity(label: 'Needs input', mode: OrbMode.wave);
  }
  if (runtimeState == 'retry_wait') {
    return const OrbActivity(label: 'Retrying', mode: OrbMode.morph);
  }
  if (runtimeState == 'compacting') {
    return const OrbActivity(label: 'Thinking', mode: OrbMode.ring);
  }
  if (status.phase == PromptSendPhase.acquiringControl) {
    return const OrbActivity(label: 'Connecting', mode: OrbMode.web);
  }
  if (status.phase == PromptSendPhase.submitting) {
    return const OrbActivity(label: 'Sending', mode: OrbMode.ribbon);
  }
  return const OrbActivity(label: 'Thinking', mode: OrbMode.orbits);
}

/// A reusable bounded canvas. The widget itself does not rebuild for frames;
/// the [CustomPainter] listens directly to the controller's repaint signal.
class OrbCanvas extends StatefulWidget {
  const OrbCanvas({
    required this.mode,
    this.size = 180,
    this.active = true,
    this.paused = false,
    super.key,
  });

  final OrbMode mode;
  final double size;
  final bool active;
  final bool paused;

  @override
  State<OrbCanvas> createState() => _OrbCanvasState();
}

class _OrbCanvasState extends State<OrbCanvas>
    with SingleTickerProviderStateMixin {
  AnimationController? _controller;
  bool _reducedMotion = false;
  bool _tickerEnabled = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final tickerEnabled = TickerMode.valuesOf(context).enabled;
    if (reduced != _reducedMotion || tickerEnabled != _tickerEnabled) {
      _reducedMotion = reduced;
      _tickerEnabled = tickerEnabled;
      _syncAnimation();
    } else if (_controller == null) {
      _syncAnimation();
    }
  }

  @override
  void didUpdateWidget(covariant OrbCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active != widget.active ||
        oldWidget.paused != widget.paused) {
      _syncAnimation();
    }
  }

  void _syncAnimation() {
    final shouldAnimate =
        widget.active && !widget.paused && !_reducedMotion && _tickerEnabled;
    if (!shouldAnimate) {
      _controller?.stop();
      if (_reducedMotion && _controller != null) {
        // The upstream component uses one stable representative frame for
        // reduced-motion users rather than freezing an arbitrary live frame.
        _controller!.value = .6;
      }
      return;
    }
    final controller = _controller ??= AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 5200),
    );
    if (!controller.isAnimating) controller.repeat();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dimension = widget.size.clamp(1.0, 420.0).toDouble();
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: dimension,
        child: CustomPaint(
          painter: _OrbPainter(
            mode: widget.mode,
            active: widget.active,
            colors: Theme.of(context).colorScheme,
            animation: _controller,
          ),
        ),
      ),
    );
  }
}

/// Existing transcript disclosure callers retain this compact API.
class ReasoningOrb extends StatelessWidget {
  const ReasoningOrb({required this.active, this.size = 30, super.key});

  final bool active;
  final double size;

  @override
  Widget build(BuildContext context) => OrbCanvas(
    key: key,
    mode: OrbMode.orbits,
    size: size.clamp(24.0, 48.0).toDouble(),
    active: active,
  );
}

class _OrbDot {
  const _OrbDot(this.x, this.y, this.z, this.radius, this.color, this.alpha);

  final double x;
  final double y;
  final double z;
  final double radius;
  final Color color;
  final double alpha;
}

class _OrbLine {
  const _OrbLine(this.a, this.b, this.color, this.alpha);

  final Offset a;
  final Offset b;
  final Color color;
  final double alpha;
}

class _OrbPainter extends CustomPainter {
  _OrbPainter({
    required this.mode,
    required this.active,
    required this.colors,
    this.animation,
  }) : super(repaint: animation);

  final OrbMode mode;
  final bool active;
  final ColorScheme colors;
  final Animation<double>? animation;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    // The upstream canvas uses a shared seconds clock. A deterministic 0.6
    // frame is used when reduced motion stops the controller.
    final t = (animation?.value ?? 0.6) * math.pi * 2;
    final center = Offset(size.width / 2, size.height / 2);
    final radius = math.min(size.width, size.height) * .42;
    final dots = <_OrbDot>[];
    final lines = <_OrbLine>[];
    _buildGeometry(dots, lines, center, radius, t);
    dots.sort((a, b) => a.z.compareTo(b.z));

    final substrate = Paint()
      ..shader = RadialGradient(
        colors: <Color>[
          colors.primary.withValues(alpha: .22),
          colors.secondary.withValues(alpha: .08),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: center, radius: radius * 1.35));
    canvas.drawCircle(center, radius * 1.12, substrate);

    final linePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = math.max(.55, radius / 105);
    for (final line in lines) {
      linePaint.color = line.color.withValues(alpha: line.alpha);
      canvas.drawLine(line.a, line.b, linePaint);
    }
    final dotPaint = Paint();
    for (final dot in dots) {
      dotPaint.color = dot.color.withValues(alpha: dot.alpha);
      canvas.drawCircle(Offset(dot.x, dot.y), dot.radius, dotPaint);
    }
    if (!active) _drawCompletion(canvas, center, radius);
  }

  void _drawCompletion(Canvas canvas, Offset center, double radius) {
    final paint = Paint()
      ..color = colors.secondary.withValues(alpha: .76)
      ..style = PaintingStyle.stroke
      ..strokeWidth = math.max(1.2, radius * .035)
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final check = Path()
      ..moveTo(center.dx - radius * .24, center.dy)
      ..lineTo(center.dx - radius * .06, center.dy + radius * .18)
      ..lineTo(center.dx + radius * .3, center.dy - radius * .22);
    canvas.drawPath(check, paint);
  }

  void _buildGeometry(
    List<_OrbDot> dots,
    List<_OrbLine> lines,
    Offset c,
    double r,
    double t,
  ) {
    switch (mode) {
      case OrbMode.orbits:
        _orbits(dots, c, r, t);
      case OrbMode.globe:
        _globe(dots, c, r, t, scan: true);
      case OrbMode.rubik:
        _globe(dots, c, r, t, scan: false, twist: true);
      case OrbMode.wave:
        _wave(dots, c, r, t);
      case OrbMode.web:
        _web(dots, lines, c, r, t);
      case OrbMode.braid:
        _braid(dots, c, r, t);
      case OrbMode.ribbon:
        _ribbon(dots, c, r, t, faceOn: false);
      case OrbMode.ring:
        _ribbon(dots, c, r, t, faceOn: true);
      case OrbMode.morph:
        _morph(dots, c, r, t);
    }
  }

  void _orbits(List<_OrbDot> dots, Offset c, double r, double t) {
    // Upstream orbits: tilted planes, ghost paths, and running particles.
    for (var orbit = 0; orbit < 12; orbit++) {
      final h1 = _hash(orbit, 1.7);
      final h2 = _hash(orbit, 5.2);
      final h3 = _hash(orbit, 8.9);
      final orbitRadius = r * (.45 + .52 * h1);
      final tilt = .22 + .62 * h2;
      final phase = h2 * math.pi * 2;
      for (var k = 0; k < 10; k++) {
        final a = k / 10 * math.pi * 2;
        final p = _project(
          math.cos(a + phase) * orbitRadius,
          math.sin(a + phase) * orbitRadius * tilt,
          math.sin(a + phase) * orbitRadius * (1 - tilt),
          c,
          1,
          yaw: t * .12,
          cameraTilt: .3,
        );
        final depth = (p.z / (r * 1.2) + 1) / 2;
        dots.add(_dot(p, r * .012, colors.primary, .14 + depth * .18));
      }
      for (var particle = 0; particle < 3; particle++) {
        final a = t * (.25 + .55 * h3) + particle * math.pi * 2 / 3 + phase;
        final p = _project(
          math.cos(a) * orbitRadius,
          math.sin(a) * orbitRadius * tilt,
          math.sin(a) * orbitRadius * (1 - tilt),
          c,
          1,
          yaw: t * .12,
          cameraTilt: .3,
        );
        final depth = (p.z / (r * 1.2) + 1) / 2;
        dots.add(_dot(p, r * (.018 + .025 * depth), colors.tertiary, .55));
      }
    }
  }

  void _globe(
    List<_OrbDot> dots,
    Offset c,
    double r,
    double t, {
    required bool scan,
    bool twist = false,
  }) {
    // Upstream globe/rubik lattices share a depth-shaded latitude/longitude
    // field; rubik adds deterministic quarter-turn bands.
    const rings = 11;
    for (var ring = 0; ring <= rings; ring++) {
      final lat = -math.pi / 2 + ring / rings * math.pi;
      final cosLat = math.cos(lat);
      final sinLat = math.sin(lat);
      final count = math.max(4, (cosLat.abs() * 22).round());
      for (var point = 0; point < count; point++) {
        var lon = point / count * math.pi * 2;
        if (twist) {
          final band = ring % 4 == 1 ? .55 * math.sin(t * .7) : 0;
          lon += band;
        }
        final wobble = twist ? .025 * math.sin(t + ring) : 0;
        final p = _project(
          cosLat * math.cos(lon) * r * (1 + wobble),
          sinLat * r,
          cosLat * math.sin(lon) * r * (1 + wobble),
          c,
          1,
          yaw: t * (twist ? .55 : .5),
          cameraTilt: .38,
        );
        final depth = (p.z / r + 1) / 2;
        final boost = scan
            ? math.exp(-_angularDistance(lon + t * .5, t * 2.1).abs() * 5) *
                  math.max(0, p.z / r)
            : (ring % 4 == 1 ? .18 : 0);
        dots.add(
          _dot(
            p,
            r * (.014 + .032 * depth + .025 * boost),
            scan ? colors.secondary : colors.primary,
            .25 + .55 * depth,
          ),
        );
      }
    }
  }

  void _wave(List<_OrbDot> dots, Offset c, double r, double t) {
    for (var ring = 0; ring <= 10; ring++) {
      final lat = -math.pi / 2 + ring / 10 * math.pi;
      final wave =
          .62 * math.sin(t * 2.1 - ring * .52) +
          .38 * math.sin(t * 1.27 + ring * .83);
      final rr = r * (.88 + .105 * wave);
      final cosLat = math.cos(lat);
      final count = math.max(4, (cosLat.abs() * 22).round());
      for (var point = 0; point < count; point++) {
        final lon = point / count * math.pi * 2;
        final p = _project(
          cosLat * math.cos(lon) * rr,
          math.sin(lat) * rr,
          cosLat * math.sin(lon) * rr,
          c,
          1,
          yaw: t * .18,
          cameraTilt: .38,
        );
        final depth = (p.z / r + 1) / 2;
        dots.add(
          _dot(
            p,
            r * (.014 + .03 * depth) * (1 + .15 * wave),
            colors.tertiary,
            .3 + .5 * depth,
          ),
        );
      }
    }
  }

  void _web(
    List<_OrbDot> dots,
    List<_OrbLine> lines,
    Offset c,
    double r,
    double t,
  ) {
    final nodes = <Offset>[];
    for (var i = 0; i < 24; i++) {
      final a = _hash(i, 2.4) * math.pi * 2 + t * .16;
      final rr = r * (.35 + .6 * _hash(i, 7.1));
      final p = Offset(c.dx + math.cos(a) * rr, c.dy + math.sin(a) * rr * .72);
      nodes.add(p);
      dots.add(
        _dot3(
          p,
          (i % 5 == 0 ? .04 : .022) * r,
          i % 3 == 0 ? colors.secondary : colors.primary,
          .35,
        ),
      );
    }
    final linePaint = colors.primary;
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length && j < i + 3; j++) {
        lines.add(_OrbLine(nodes[i], nodes[j], linePaint, .12));
      }
    }
  }

  void _braid(List<_OrbDot> dots, Offset c, double r, double t) {
    for (var strand = 0; strand < 5; strand++) {
      for (var i = 0; i < 27; i++) {
        final p = i / 26;
        final x = (p - .5) * r * 1.75;
        final y =
            math.sin(p * math.pi * 4 + t * .8 + strand * 1.25) * r * .25 +
            (strand - 2) * r * .08;
        final z = math.cos(p * math.pi * 4 + strand) * r * .32;
        final projected = _project(
          x,
          y,
          z,
          c,
          1,
          yaw: t * .12,
          cameraTilt: .25,
        );
        dots.add(
          _dot(
            projected,
            r * (.014 + .01 * ((z / r + 1) / 2)),
            strand.isEven ? colors.primary : colors.secondary,
            .38,
          ),
        );
      }
    }
  }

  void _ribbon(
    List<_OrbDot> dots,
    Offset c,
    double r,
    double t, {
    required bool faceOn,
  }) {
    for (var lane = 0; lane < 5; lane++) {
      for (var i = 0; i < 30; i++) {
        final a = i / 30 * math.pi * 2;
        final wobble =
            .16 * math.sin(a * 3 - t * 1.7 + lane * .22) +
            .07 * math.sin(a * 5 + t * 1.1);
        final rr = r * (faceOn ? 1 + wobble : 1);
        final x = math.cos(a) * rr;
        final y =
            math.sin(a) * rr +
            (lane - 2) * r * .05 +
            (faceOn ? 0 : wobble * r * .25);
        final z = math.sin(a + lane) * r * .2;
        final p = _project(x, y, z, c, 1, yaw: 0, cameraTilt: faceOn ? 0 : .3);
        final depth = (p.z / r + 1) / 2;
        dots.add(
          _dot(
            p,
            r * (.018 + .022 * depth),
            faceOn ? colors.secondary : colors.primary,
            .38 + .45 * depth,
          ),
        );
      }
    }
  }

  void _morph(List<_OrbDot> dots, Offset c, double r, double t) {
    for (var i = 0; i < 150; i++) {
      final d = _fib(i, 150);
      final pulse = 1 + .18 * math.sin(t * 1.2 + i * .31);
      final p = _project(
        d.x * r * pulse,
        d.y * r * pulse,
        d.z * r * pulse,
        c,
        1,
        yaw: t * .22,
        cameraTilt: .32,
      );
      final depth = (p.z / r + 1) / 2;
      dots.add(
        _dot(
          p,
          r * (.009 + .026 * depth),
          i.isEven ? colors.tertiary : colors.primary,
          .25 + .55 * depth,
        ),
      );
    }
  }

  _OrbDot _dot(_Projected p, double radius, Color color, double alpha) =>
      _OrbDot(p.x, p.y, p.z, radius, color, alpha.clamp(.04, .9));

  _OrbDot _dot3(Offset p, double radius, Color color, double alpha) =>
      _OrbDot(p.dx, p.dy, 0, radius, color, alpha);

  _Projected _project(
    double x,
    double y,
    double z,
    Offset c,
    double scale, {
    required double yaw,
    required double cameraTilt,
  }) {
    final sinYaw = math.sin(yaw);
    final cosYaw = math.cos(yaw);
    final x1 = x * cosYaw + z * sinYaw;
    final z1 = -x * sinYaw + z * cosYaw;
    final sinTilt = math.sin(cameraTilt);
    final cosTilt = math.cos(cameraTilt);
    final y1 = y * cosTilt - z1 * sinTilt;
    final z2 = y * sinTilt + z1 * cosTilt;
    return _Projected(c.dx + x1 * scale, c.dy - y1 * scale, z2);
  }

  double _hash(int a, double b) {
    final value = math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return value - value.floorToDouble();
  }

  double _angularDistance(double a, double b) =>
      math.atan2(math.sin(a - b), math.cos(a - b));

  _Vec3 _fib(int i, int n) {
    final golden = math.pi * (3 - math.sqrt(5));
    final y = 1 - 2 * (i + .5) / n;
    final rr = math.sqrt(1 - y * y);
    final a = i * golden;
    return _Vec3(rr * math.cos(a), y, rr * math.sin(a));
  }

  @override
  bool shouldRepaint(covariant _OrbPainter oldDelegate) =>
      oldDelegate.mode != mode ||
      oldDelegate.active != active ||
      oldDelegate.colors != colors;
}

class _Projected {
  const _Projected(this.x, this.y, this.z);
  final double x;
  final double y;
  final double z;
}

class _Vec3 {
  const _Vec3(this.x, this.y, this.z);
  final double x;
  final double y;
  final double z;
}
