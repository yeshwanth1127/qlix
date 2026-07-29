import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

// ─── Backdrop ────────────────────────────────────────────────────────────────

/// Layered paper backdrop: accent bloom, ink shadow, and a faint dot grid.
class SketchBackdrop extends StatelessWidget {
  const SketchBackdrop({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment(-0.2, -1),
              end: Alignment(0.3, 1),
              colors: [
                QlixColors.paperHi,
                QlixColors.paper,
                QlixColors.paperLo,
              ],
              stops: [0.0, 0.55, 1.0],
            ),
          ),
        ),
        const Positioned.fill(child: CustomPaint(painter: _BloomPainter())),
        const Positioned.fill(
          child: CustomPaint(painter: _DotGridPainter()),
        ),
        child,
      ],
    );
  }
}

class _BloomPainter extends CustomPainter {
  const _BloomPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final accent = Paint()
      ..shader = RadialGradient(
        colors: [
          QlixColors.accent.withValues(alpha: 0.09),
          QlixColors.accent.withValues(alpha: 0),
        ],
      ).createShader(
        Rect.fromCircle(
          center: Offset(size.width * 0.92, size.height * -0.05),
          radius: size.width * 0.85,
        ),
      );
    canvas.drawRect(Offset.zero & size, accent);

    final ink = Paint()
      ..shader = RadialGradient(
        colors: [
          QlixColors.ink.withValues(alpha: 0.05),
          QlixColors.ink.withValues(alpha: 0),
        ],
      ).createShader(
        Rect.fromCircle(
          center: Offset(size.width * -0.08, size.height * 1.05),
          radius: size.width * 0.75,
        ),
      );
    canvas.drawRect(Offset.zero & size, ink);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _DotGridPainter extends CustomPainter {
  const _DotGridPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = QlixColors.ink.withValues(alpha: 0.045);
    const step = 26.0;
    for (var y = 0.0; y < size.height; y += step) {
      for (var x = 0.0; x < size.width; x += step) {
        canvas.drawCircle(Offset(x, y), 0.7, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ─── Glass card ──────────────────────────────────────────────────────────────

class SketchCard extends StatelessWidget {
  const SketchCard({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
    this.borderColor,
    this.tint,
  });

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final Color? borderColor;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final content = ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Container(
          padding: padding ?? const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: tint ?? QlixColors.glass,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: borderColor ?? QlixColors.inkBorder),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0A100E16),
                blurRadius: 1.5,
                offset: Offset(0, 1),
              ),
              BoxShadow(
                color: Color(0x24100E16),
                blurRadius: 28,
                offset: Offset(0, 10),
                spreadRadius: -14,
              ),
            ],
          ),
          child: child,
        ),
      ),
    );

    if (onTap == null) return content;
    return SketchPress(onTap: onTap!, child: content);
  }
}

// ─── Micro label ─────────────────────────────────────────────────────────────

class SketchLabel extends StatelessWidget {
  const SketchLabel(
    this.text, {
    super.key,
    this.color,
    this.align,
  });

  final String text;
  final Color? color;
  final TextAlign? align;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      textAlign: align,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w500,
        letterSpacing: 1.7,
        color: color ?? QlixColors.inkSecondary,
        height: 1.2,
      ),
    );
  }
}

// ─── Metric (outlined stroke number like web SketchMetric) ───────────────────

class SketchMetric extends StatelessWidget {
  const SketchMetric({
    super.key,
    required this.value,
    required this.label,
    this.detail,
  });

  final String value;
  final String label;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return SketchCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 22),
      child: Column(
        children: [
          // Dual-layer "stroke" numeral — mirrors web's WebkitTextStroke trick.
          Stack(
            alignment: Alignment.center,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize: 46,
                  fontWeight: FontWeight.w300,
                  letterSpacing: -1.5,
                  height: 1,
                  foreground: Paint()
                    ..style = PaintingStyle.stroke
                    ..strokeWidth = 1.15
                    ..color = QlixColors.ink,
                ),
              ),
              Text(
                value,
                style: TextStyle(
                  fontSize: 46,
                  fontWeight: FontWeight.w300,
                  letterSpacing: -1.5,
                  height: 1,
                  color: QlixColors.paperHi.withValues(alpha: 0.35),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SketchLabel(label, align: TextAlign.center),
          if (detail != null) ...[
            const SizedBox(height: 6),
            Text(
              detail!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 11,
                color: QlixColors.inkTertiary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

class SketchPrimaryButton extends StatelessWidget {
  const SketchPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return SketchPress(
      onTap: busy || onPressed == null ? null : onPressed,
      child: AnimatedContainer(
        duration: QlixMotion.fast,
        curve: QlixMotion.ease,
        height: 48,
        decoration: BoxDecoration(
          color: onPressed == null || busy
              ? QlixColors.ink.withValues(alpha: 0.35)
              : QlixColors.ink,
          borderRadius: BorderRadius.circular(999),
          boxShadow: onPressed == null || busy
              ? null
              : [
                  BoxShadow(
                    color: QlixColors.accent.withValues(alpha: 0.22),
                    blurRadius: 24,
                    offset: const Offset(0, 10),
                    spreadRadius: -12,
                  ),
                ],
        ),
        alignment: Alignment.center,
        child: busy
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: QlixColors.white,
                ),
              )
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[
                    Icon(icon, size: 16, color: QlixColors.white),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    label.toUpperCase(),
                    style: const TextStyle(
                      color: QlixColors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1.4,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

// ─── Press scale ─────────────────────────────────────────────────────────────

class SketchPress extends StatefulWidget {
  const SketchPress({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  State<SketchPress> createState() => _SketchPressState();
}

class _SketchPressState extends State<SketchPress> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: widget.onTap == null ? null : (_) => setState(() => _down = true),
      onTapCancel: () => setState(() => _down = false),
      onTapUp: (_) => setState(() => _down = false),
      onTap: widget.onTap == null
          ? null
          : () {
              HapticFeedback.selectionClick();
              widget.onTap!();
            },
      child: AnimatedScale(
        scale: _down ? 0.98 : 1,
        duration: QlixMotion.fast,
        curve: QlixMotion.ease,
        child: widget.child,
      ),
    );
  }
}

// ─── Section enter animation (qlix-section-in) ────────────────────────────────

class SectionIn extends StatefulWidget {
  const SectionIn({
    super.key,
    required this.child,
    this.index = 0,
    this.duration = QlixMotion.section,
  });

  final Widget child;
  final int index;
  final Duration duration;

  @override
  State<SectionIn> createState() => _SectionInState();
}

class _SectionInState extends State<SectionIn>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: widget.duration,
  );
  late final Animation<double> _opacity = CurvedAnimation(
    parent: _c,
    curve: QlixMotion.ease,
  );
  late final Animation<Offset> _slide = Tween<Offset>(
    begin: const Offset(0, 0.04),
    end: Offset.zero,
  ).animate(CurvedAnimation(parent: _c, curve: QlixMotion.ease));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    final reduce = MediaQuery.disableAnimationsOf(context);
    if (reduce) {
      _c.value = 1;
    } else {
      Future<void>.delayed(QlixMotion.stagger * widget.index, () {
        if (mounted) _c.forward();
      });
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _opacity,
      child: SlideTransition(position: _slide, child: widget.child),
    );
  }
}

// ─── Shimmer skeleton ────────────────────────────────────────────────────────

class SketchSkeleton extends StatefulWidget {
  const SketchSkeleton({
    super.key,
    this.height = 72,
    this.width,
    this.radius = 16,
  });

  final double height;
  final double? width;
  final double radius;

  @override
  State<SketchSkeleton> createState() => _SketchSkeletonState();
}

class _SketchSkeletonState extends State<SketchSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        return Container(
          height: widget.height,
          width: widget.width,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.radius),
            border: Border.all(color: QlixColors.inkBorder),
            gradient: LinearGradient(
              begin: Alignment(-1.2 + 2.4 * _c.value, 0),
              end: Alignment(-0.2 + 2.4 * _c.value, 0),
              colors: [
                QlixColors.glass,
                QlixColors.white,
                QlixColors.glass,
              ],
            ),
          ),
        );
      },
    );
  }
}

// ─── Status pulse ────────────────────────────────────────────────────────────

class StatusPulse extends StatefulWidget {
  const StatusPulse({super.key, required this.color, this.size = 10});

  final Color color;
  final double size;

  @override
  State<StatusPulse> createState() => _StatusPulseState();
}

class _StatusPulseState extends State<StatusPulse>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size * 2.2,
      height: widget.size * 2.2,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          final t = Curves.easeOut.transform(_c.value);
          return CustomPaint(
            painter: _PulsePainter(
              color: widget.color,
              progress: t,
              core: widget.size / 2,
            ),
          );
        },
      ),
    );
  }
}

class _PulsePainter extends CustomPainter {
  _PulsePainter({
    required this.color,
    required this.progress,
    required this.core,
  });

  final Color color;
  final double progress;
  final double core;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final ring = Paint()
      ..color = color.withValues(alpha: (1 - progress) * 0.35)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    canvas.drawCircle(c, core + progress * core * 1.6, ring);
    canvas.drawCircle(c, core, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _PulsePainter old) =>
      old.progress != progress || old.color != color;
}

// ─── Brand mark ──────────────────────────────────────────────────────────────

class QlixMark extends StatelessWidget {
  const QlixMark({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: QlixColors.ink,
        borderRadius: BorderRadius.circular(size * 0.28),
        boxShadow: [
          BoxShadow(
            color: QlixColors.accent.withValues(alpha: 0.35),
            blurRadius: 18,
            offset: const Offset(0, 6),
            spreadRadius: -6,
          ),
        ],
      ),
      child: CustomPaint(painter: _MarkPainter(size: size)),
    );
  }
}

class _MarkPainter extends CustomPainter {
  _MarkPainter({required this.size});
  final double size;

  @override
  void paint(Canvas canvas, Size s) {
    final p = Paint()
      ..color = QlixColors.accent
      ..strokeWidth = size * 0.08
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    final path = Path()
      ..moveTo(s.width * 0.32, s.height * 0.68)
      ..lineTo(s.width * 0.48, s.height * 0.32)
      ..lineTo(s.width * 0.58, s.height * 0.52)
      ..lineTo(s.width * 0.72, s.height * 0.32);
    canvas.drawPath(path, p);
    canvas.drawCircle(
      Offset(s.width * 0.72, s.height * 0.32),
      size * 0.05,
      Paint()..color = QlixColors.white,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ─── Ambient orbit (futuristic loader / empty state) ─────────────────────────

class OrbitLoader extends StatefulWidget {
  const OrbitLoader({super.key, this.size = 56});

  final double size;

  @override
  State<OrbitLoader> createState() => _OrbitLoaderState();
}

class _OrbitLoaderState extends State<OrbitLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          return CustomPaint(
            painter: _OrbitPainter(t: _c.value),
          );
        },
      ),
    );
  }
}

class _OrbitPainter extends CustomPainter {
  _OrbitPainter({required this.t});
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = size.width * 0.38;
    canvas.drawCircle(
      c,
      r,
      Paint()
        ..color = QlixColors.inkBorderStrong
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    canvas.drawCircle(
      c,
      r * 0.55,
      Paint()
        ..color = QlixColors.accent.withValues(alpha: 0.15)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    final a1 = t * math.pi * 2;
    final a2 = a1 + math.pi * 0.7;
    canvas.drawCircle(
      c + Offset(math.cos(a1) * r, math.sin(a1) * r),
      3.5,
      Paint()..color = QlixColors.accent,
    );
    canvas.drawCircle(
      c + Offset(math.cos(a2) * r * 0.55, math.sin(a2) * r * 0.55),
      2.2,
      Paint()..color = QlixColors.ink,
    );
  }

  @override
  bool shouldRepaint(covariant _OrbitPainter old) => old.t != t;
}
