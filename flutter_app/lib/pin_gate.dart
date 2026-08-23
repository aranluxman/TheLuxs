import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pinput/pinput.dart';

/// Privacy defaults for a shared-device family tracker.
class PinSecurityConfig {
  static const inactivityTimeout = Duration(seconds: 60);
  static const maxFailedAttemptsBeforeCooldown = 5;
  static const maxCooldown = Duration(seconds: 30);
}

/// The current data model has one anonymous device session and no per-member
/// PIN field. A single household PIN is therefore used for every profile.
/// TODO(security): introduce a trusted per-member PIN verifier before switching
/// to per-profile PINs; never read a member's PIN hash into the client.
class PinStore {
  PinStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  static const _pinHashKey = 'family_tracker_pin_hash';
  static const _legacyRawPinKey = 'family_tracker_pin';
  static final _pinPattern = RegExp(r'^\d{4}$');

  // flutter_secure_storage uses Keychain on iOS and encrypted Android storage
  // backed by the Android Keystore. No shared_preferences dependency is used.
  final FlutterSecureStorage _storage;

  Future<void> migrateLegacyPinIfNeeded() async {
    final currentHash = await _storage.read(key: _pinHashKey);
    if (currentHash != null) {
      await _storage.delete(key: _legacyRawPinKey);
      return;
    }

    // One-time migration for the only legacy key this app has used. If an
    // older build stored a PIN in shared_preferences, this code intentionally
    // does not reintroduce that insecure dependency; this project contains no
    // shared_preferences package or existing migration source to read.
    final legacyRawPin = await _storage.read(key: _legacyRawPinKey);
    if (legacyRawPin != null && _pinPattern.hasMatch(legacyRawPin)) {
      await savePin(legacyRawPin);
      await _storage.delete(key: _legacyRawPinKey);
    }
  }

  Future<bool> hasPin() async {
    await migrateLegacyPinIfNeeded();
    return (await _storage.read(key: _pinHashKey)) != null;
  }

  Future<void> savePin(String pin) async {
    if (!_pinPattern.hasMatch(pin)) {
      throw ArgumentError.value(pin, 'pin', 'PIN must contain exactly 4 digits.');
    }
    await _storage.write(key: _pinHashKey, value: _hash(pin));
  }

  Future<bool> verify(String pin) async {
    await migrateLegacyPinIfNeeded();
    final savedHash = await _storage.read(key: _pinHashKey);
    return savedHash != null && savedHash == _hash(pin);
  }

  String _hash(String pin) => sha256.convert(utf8.encode(pin)).toString();
}

class _PinAttemptLimiter {
  static int _failedAttempts = 0;
  static DateTime? _lockedUntil;

  static Duration? get remaining {
    final until = _lockedUntil;
    if (until == null) return null;
    final duration = until.difference(DateTime.now());
    if (duration.isNegative || duration == Duration.zero) {
      _lockedUntil = null;
      return null;
    }
    return duration;
  }

  static void recordFailure() {
    _failedAttempts += 1;
    final exponent = math.min(_failedAttempts - 1, 4);
    final seconds = math
        .min(1 << exponent, PinSecurityConfig.maxCooldown.inSeconds)
        .toInt();
    _lockedUntil = DateTime.now().add(Duration(seconds: seconds));
  }

  static void reset() {
    _failedAttempts = 0;
    _lockedUntil = null;
  }
}

Future<bool> requireFamilyPin(
  BuildContext context, {
  String title = 'Unlock family details',
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => PinGate(title: title),
  );
  return result == true;
}

/// Covers the entire app until a valid household PIN is entered.
class AppSecurityGate extends StatefulWidget {
  const AppSecurityGate({
    super.key,
    required this.child,
    this.inactivityTimeout = PinSecurityConfig.inactivityTimeout,
  });

  final Widget child;
  final Duration inactivityTimeout;

  @override
  State<AppSecurityGate> createState() => _AppSecurityGateState();
}

class _AppSecurityGateState extends State<AppSecurityGate>
    with WidgetsBindingObserver {
  Timer? _inactivityTimer;
  bool _locked = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // paused is the background transition on iOS and Android. Lock again on
    // resumed as a defense-in-depth measure in case the OS skips paused.
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.resumed) {
      _lock();
    }
  }

  void _lock() {
    _inactivityTimer?.cancel();
    if (!mounted) return;

    // A modal profile/settings sheet is a Navigator route above this widget.
    // Close transient routes before showing the full-screen lock so they cannot
    // remain visible when the app resumes or the inactivity timer fires.
    Navigator.maybeOf(context)?.popUntil((route) => route.isFirst);
    if (!_locked) setState(() => _locked = true);
  }

  void _unlock() {
    if (!mounted) return;
    setState(() => _locked = false);
    _armInactivityTimer();
  }

  void _armInactivityTimer() {
    _inactivityTimer?.cancel();
    _inactivityTimer = Timer(widget.inactivityTimeout, _lock);
  }

  void _recordInteraction() {
    if (!_locked) _armInactivityTimer();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _inactivityTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: (_) => _recordInteraction(),
      child: Stack(
        fit: StackFit.expand,
        children: [
          ExcludeSemantics(
            excluding: _locked,
            child: IgnorePointer(
              ignoring: _locked,
              child: widget.child,
            ),
          ),
          if (_locked)
            Positioned.fill(
              child: PinGate(
                title: 'Unlock family tracker',
                fullScreen: true,
                canCancel: false,
                onUnlocked: _unlock,
              ),
            ),
        ],
      ),
    );
  }
}

class PinGate extends StatefulWidget {
  const PinGate({
    super.key,
    this.title = 'Unlock family details',
    this.onUnlocked,
    this.fullScreen = false,
    this.canCancel = true,
  });

  final String title;
  final FutureOr<void> Function()? onUnlocked;
  final bool fullScreen;
  final bool canCancel;

  @override
  State<PinGate> createState() => _PinGateState();
}

class _PinGateState extends State<PinGate>
    with SingleTickerProviderStateMixin {
  final _pinStore = PinStore();
  final _pinController = TextEditingController();
  late final AnimationController _shakeController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 420),
  );

  Timer? _cooldownTimer;
  bool _loading = true;
  bool _settingUp = false;
  String? _firstPin;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadPinState();
  }

  Future<void> _loadPinState() async {
    final hasPin = await _pinStore.hasPin();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _settingUp = !hasPin;
    });
    _startCooldownTicker();
  }

  Future<void> _submit(String pin) async {
    final remaining = _PinAttemptLimiter.remaining;
    if (remaining != null) {
      _setCooldownError(remaining);
      return;
    }

    if (_settingUp) {
      if (_firstPin == null) {
        setState(() => _firstPin = pin);
        _pinController.clear();
        return;
      }
      if (_firstPin != pin) {
        _showError('PINs do not match. Try again.');
        setState(() => _firstPin = null);
        _pinController.clear();
        return;
      }
      await _pinStore.savePin(pin);
      await _complete();
      return;
    }

    if (await _pinStore.verify(pin)) {
      _PinAttemptLimiter.reset();
      await _complete();
    } else {
      _PinAttemptLimiter.recordFailure();
      _showError('Incorrect PIN. Try again.');
      _pinController.clear();
      _startCooldownTicker();
    }
  }

  Future<void> _complete() async {
    if (!mounted) return;
    final callback = widget.onUnlocked;
    if (callback != null) {
      await callback();
    } else {
      Navigator.of(context).pop(true);
    }
  }

  void _startCooldownTicker() {
    _cooldownTimer?.cancel();
    if (_PinAttemptLimiter.remaining == null) return;
    _cooldownTimer = Timer.periodic(const Duration(milliseconds: 250), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      final remaining = _PinAttemptLimiter.remaining;
      if (remaining == null) {
        timer.cancel();
        if (_error?.startsWith('Too many') == true) {
          setState(() => _error = null);
        }
      } else {
        _setCooldownError(remaining);
      }
    });
  }

  void _setCooldownError(Duration remaining) {
    final seconds = math.max(1, remaining.inSeconds + (remaining.inMilliseconds % 1000 == 0 ? 0 : 1));
    if (mounted) setState(() => _error = 'Too many attempts. Try again in ${seconds}s.');
  }

  void _showError(String message) {
    _shakeController.forward(from: 0);
    if (!mounted) return;
    setState(() => _error = message);
  }

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    _pinController.dispose();
    _shakeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final baseDecoration = BoxDecoration(
      color: const Color(0xFF172826),
      borderRadius: BorderRadius.circular(16),
    );
    final pinTheme = PinTheme(
      width: 58,
      height: 64,
      textStyle: theme.textTheme.headlineSmall?.copyWith(
        fontWeight: FontWeight.w700,
      ),
      decoration: baseDecoration,
    );

    return Material(
      color: const Color(0xFF0F1C1A),
      borderRadius: widget.fullScreen
          ? BorderRadius.zero
          : const BorderRadius.vertical(top: Radius.circular(32)),
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            24,
            widget.fullScreen ? 24 : 12,
            24,
            24 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : Center(
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (!widget.fullScreen)
                          Container(
                            width: 42,
                            height: 4,
                            decoration: BoxDecoration(
                              color: Colors.white24,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        const SizedBox(height: 26),
                        const Icon(Icons.lock_rounded, size: 42),
                        const SizedBox(height: 14),
                        Text(
                          _settingUp
                              ? (_firstPin == null
                                  ? 'Create your 4-digit PIN'
                                  : 'Confirm your PIN')
                              : widget.title,
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _settingUp
                              ? 'This PIN is stored only in device secure storage.'
                              : 'Enter your PIN to view private family information.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodyMedium?.copyWith(
                                color: Colors.white60,
                              ),
                        ),
                        const SizedBox(height: 26),
                        AnimatedBuilder(
                          animation: _shakeController,
                          builder: (context, child) {
                            final x = math.sin(
                                  _shakeController.value * math.pi * 6,
                                ) *
                                (1 - _shakeController.value) *
                                10;
                            return Transform.translate(
                              offset: Offset(x, 0),
                              child: child,
                            );
                          },
                          child: Pinput(
                            controller: _pinController,
                            autofocus: true,
                            length: 4,
                            obscureText: true,
                            obscuringWidget: const Icon(Icons.circle, size: 10),
                            keyboardType: TextInputType.number,
                            defaultPinTheme: pinTheme,
                            focusedPinTheme: PinTheme(
                              width: 58,
                              height: 64,
                              textStyle: pinTheme.textStyle,
                              decoration: BoxDecoration(
                                color: const Color(0xFF172826),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: theme.colorScheme.primary,
                                  width: 2,
                                ),
                              ),
                            ),
                            errorPinTheme: PinTheme(
                              width: 58,
                              height: 64,
                              textStyle: pinTheme.textStyle,
                              decoration: BoxDecoration(
                                color: theme.colorScheme.errorContainer,
                                borderRadius: BorderRadius.circular(16),
                              ),
                            ),
                            forceErrorState: _error != null,
                            errorText: _error,
                            onChanged: (_) {
                              if (_error != null &&
                                  _PinAttemptLimiter.remaining == null) {
                                setState(() => _error = null);
                              }
                            },
                            onCompleted: _submit,
                          ),
                        ),
                        if (widget.canCancel) ...[
                          const SizedBox(height: 22),
                          TextButton(
                            onPressed: () => Navigator.of(context).pop(false),
                            child: const Text('Cancel'),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}
