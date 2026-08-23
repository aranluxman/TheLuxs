import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pinput/pinput.dart';

/// Privacy defaults for a shared-device family tracker.
class PinSecurityConfig {
  static const inactivityTimeout = Duration(seconds: 60);
  static const maxFailedAttemptsBeforeCooldown = 5;
  static const maxCooldown = Duration(seconds: 30);

  /// PBKDF2-HMAC-SHA256 work factor.
  ///
  /// A 4-digit PIN has only 10,000 candidates, so the KDF is what stands
  /// between a Keystore/Keychain dump and the PIN. At 100k iterations an
  /// offline sweep of the whole keyspace costs hours of compute per device
  /// instead of the milliseconds a bare SHA-256 needed. It does not make a
  /// 4-digit PIN strong — nothing can — it makes it expensive, and that plus
  /// the on-device attempt limiter is the realistic defence. See the note on
  /// [PinStore] for what would raise the ceiling further.
  static const pbkdf2Iterations = 120000;

  /// 16 bytes is the PBKDF2 floor in RFC 8018; 32 costs nothing extra here.
  static const saltBytes = 32;
  static const derivedKeyBytes = 32;
}

/// How the PIN is currently stored on this device.
enum PinStorageState {
  /// No PIN has been set — first run.
  none,

  /// A bare SHA-256 digest from before salting and PBKDF2 were introduced.
  /// Verifiable, but must be re-derived under the new scheme once the owner
  /// proves they know it.
  legacyUnsalted,

  /// Salted PBKDF2. Current.
  current,
}

/* ------------------------------------------------------------------ PBKDF2 */

/// Arguments for [_derivePbkdf2], which runs on a background isolate.
@immutable
class _Pbkdf2Request {
  const _Pbkdf2Request({
    required this.pin,
    required this.salt,
    required this.iterations,
    required this.keyLength,
  });

  final String pin;
  final Uint8List salt;
  final int iterations;
  final int keyLength;
}

/// PBKDF2-HMAC-SHA256, per RFC 8018 §5.2.
///
/// Top-level so it can be handed to [compute]. 120k iterations of pure-Dart
/// HMAC takes long enough to stutter an animation, and the lock screen is
/// exactly where a dropped frame is most visible.
Uint8List _derivePbkdf2(_Pbkdf2Request request) {
  const hashLength = 32; // SHA-256
  final hmac = Hmac(sha256, utf8.encode(request.pin));
  final blockCount = (request.keyLength / hashLength).ceil();
  final output = Uint8List(blockCount * hashLength);

  for (var block = 1; block <= blockCount; block++) {
    // INT_32_BE(block), appended to the salt for the first HMAC of each block.
    final seed = Uint8List(request.salt.length + 4)
      ..setRange(0, request.salt.length, request.salt)
      ..[request.salt.length] = (block >> 24) & 0xff
      ..[request.salt.length + 1] = (block >> 16) & 0xff
      ..[request.salt.length + 2] = (block >> 8) & 0xff
      ..[request.salt.length + 3] = block & 0xff;

    var u = Uint8List.fromList(hmac.convert(seed).bytes);
    final accumulator = Uint8List.fromList(u);

    for (var iteration = 1; iteration < request.iterations; iteration++) {
      u = Uint8List.fromList(hmac.convert(u).bytes);
      for (var i = 0; i < hashLength; i++) {
        accumulator[i] ^= u[i];
      }
    }
    output.setRange((block - 1) * hashLength, block * hashLength, accumulator);
  }

  return Uint8List.sublistView(output, 0, request.keyLength);
}

/// Length-independent comparison, so a wrong PIN cannot be narrowed down by
/// timing how long the mismatch took to find.
bool _constantTimeEquals(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  var difference = 0;
  for (var i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }
  return difference == 0;
}

/* --------------------------------------------------------------- PinStore */

/// The current data model has one anonymous device session and no per-member
/// PIN field. A single household PIN is therefore used for every profile.
/// TODO(security): introduce a trusted per-member PIN verifier before switching
/// to per-profile PINs; never read a member's PIN hash into the client.
///
/// TODO(security): a 4-digit PIN plus a KDF is a delay, not a wall. The next
/// real step is to stop treating the PIN as the secret: generate a random key
/// at enrolment, seal it behind the platform's biometric/credential prompt
/// (`flutter_secure_storage` on iOS supports `accessibility` and access
/// control; Android has `setUserAuthenticationRequired` on the Keystore key),
/// and let the OS enforce rate limiting in hardware. That moves the attack
/// from "10,000 guesses offline" to "defeat the secure enclave".
class PinStore {
  PinStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  /// Salted PBKDF2 record. Current format.
  static const _pinRecordKey = 'family_tracker_pin_record';

  /// Bare, unsalted SHA-256 hex digest. Superseded.
  static const _legacyHashKey = 'family_tracker_pin_hash';

  /// Plaintext PIN. Superseded twice over.
  static const _legacyRawPinKey = 'family_tracker_pin';

  static final _pinPattern = RegExp(r'^\d{4}$');
  static final _sha256HexPattern = RegExp(r'^[0-9a-f]{64}$');

  /// `pbkdf2-sha256$<iterations>$<base64 salt>$<base64 key>`
  static const _recordPrefix = 'pbkdf2-sha256';

  // flutter_secure_storage uses Keychain on iOS and encrypted Android storage
  // backed by the Android Keystore. No shared_preferences dependency is used —
  // a salt is not secret, but splitting the record across two stores would
  // only add a way for them to disagree.
  final FlutterSecureStorage _storage;

  final _random = math.Random.secure();

  Uint8List _newSalt() {
    final salt = Uint8List(PinSecurityConfig.saltBytes);
    for (var i = 0; i < salt.length; i++) {
      salt[i] = _random.nextInt(256);
    }
    return salt;
  }

  /// Silently upgrades the one legacy format that can be upgraded without the
  /// owner: a plaintext PIN, which is enough to re-derive from. The unsalted
  /// digest cannot be — it needs the PIN itself, which is why it surfaces as
  /// [PinStorageState.legacyUnsalted] instead.
  Future<void> _migratePlaintextPinIfNeeded() async {
    final rawPin = await _storage.read(key: _legacyRawPinKey);
    if (rawPin == null) return;

    if (_pinPattern.hasMatch(rawPin) &&
        await _storage.read(key: _pinRecordKey) == null) {
      await savePin(rawPin);
    }
    await _storage.delete(key: _legacyRawPinKey);
  }

  Future<PinStorageState> state() async {
    await _migratePlaintextPinIfNeeded();

    if (await _storage.read(key: _pinRecordKey) != null) {
      return PinStorageState.current;
    }
    final legacy = await _storage.read(key: _legacyHashKey);
    if (legacy != null && _sha256HexPattern.hasMatch(legacy)) {
      return PinStorageState.legacyUnsalted;
    }
    // A legacy value that is neither a valid digest nor absent is corrupt;
    // treating it as "no PIN" would silently unlock the app, so it is dropped
    // and enrolment starts over.
    if (legacy != null) await _storage.delete(key: _legacyHashKey);
    return PinStorageState.none;
  }

  Future<void> savePin(String pin) async {
    if (!_pinPattern.hasMatch(pin)) {
      throw ArgumentError.value(pin, 'pin', 'PIN must contain exactly 4 digits.');
    }

    final salt = _newSalt();
    final derived = await compute(
      _derivePbkdf2,
      _Pbkdf2Request(
        pin: pin,
        salt: salt,
        iterations: PinSecurityConfig.pbkdf2Iterations,
        keyLength: PinSecurityConfig.derivedKeyBytes,
      ),
    );

    // The iteration count is stored per record rather than read from the
    // constant, so raising the work factor later does not lock anyone out.
    final record = [
      _recordPrefix,
      '${PinSecurityConfig.pbkdf2Iterations}',
      base64.encode(salt),
      base64.encode(derived),
    ].join(r'$');

    await _storage.write(key: _pinRecordKey, value: record);
    // Only once the replacement is durably written.
    await _storage.delete(key: _legacyHashKey);
    await _storage.delete(key: _legacyRawPinKey);
  }

  /// Verifies against whichever format is stored.
  ///
  /// A correct PIN checked against the legacy digest is re-saved under PBKDF2
  /// on the spot — that is the whole upgrade, and it happens exactly once,
  /// at the moment the owner proves they know the PIN.
  Future<bool> verify(String pin) async {
    if (!_pinPattern.hasMatch(pin)) return false;

    final record = await _storage.read(key: _pinRecordKey);
    if (record != null) return _verifyRecord(pin, record);

    final legacy = await _storage.read(key: _legacyHashKey);
    if (legacy == null) return false;

    final matches = _constantTimeEquals(
      utf8.encode(sha256.convert(utf8.encode(pin)).toString()),
      utf8.encode(legacy),
    );
    if (matches) await savePin(pin);
    return matches;
  }

  Future<bool> _verifyRecord(String pin, String record) async {
    final parts = record.split(r'$');
    if (parts.length != 4 || parts[0] != _recordPrefix) return false;

    final iterations = int.tryParse(parts[1]);
    if (iterations == null || iterations <= 0) return false;

    final Uint8List salt;
    final Uint8List expected;
    try {
      salt = base64.decode(parts[2]);
      expected = base64.decode(parts[3]);
    } on FormatException {
      return false;
    }

    final derived = await compute(
      _derivePbkdf2,
      _Pbkdf2Request(
        pin: pin,
        salt: salt,
        iterations: iterations,
        keyLength: expected.length,
      ),
    );
    if (!_constantTimeEquals(derived, expected)) return false;

    // Re-derive under the current work factor if this record predates a raise.
    if (iterations < PinSecurityConfig.pbkdf2Iterations) await savePin(pin);
    return true;
  }
}

/* --------------------------------------------------------- attempt limiter */

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

/* ------------------------------------------------------------------- gates */

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

  /// True while PBKDF2 is running. It takes long enough to notice, so the
  /// screen says so rather than appearing to have swallowed the entry.
  bool _working = false;

  PinStorageState _storageState = PinStorageState.none;
  String? _firstPin;
  String? _error;

  bool get _settingUp => _storageState == PinStorageState.none;
  bool get _upgrading => _storageState == PinStorageState.legacyUnsalted;

  @override
  void initState() {
    super.initState();
    _loadPinState();
  }

  Future<void> _loadPinState() async {
    final state = await _pinStore.state();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _storageState = state;
    });
    _startCooldownTicker();
  }

  Future<void> _submit(String pin) async {
    final remaining = _PinAttemptLimiter.remaining;
    if (remaining != null) {
      _setCooldownError(remaining);
      _pinController.clear();
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
      await _runWork(() => _pinStore.savePin(pin));
      await _complete();
      return;
    }

    // Covers both a normal unlock and the one-time upgrade: `verify` re-saves
    // a correct PIN under PBKDF2 when it finds the legacy digest.
    final ok = await _runWork(() => _pinStore.verify(pin));
    if (!mounted) return;

    if (ok == true) {
      _PinAttemptLimiter.reset();
      await _complete();
    } else {
      _PinAttemptLimiter.recordFailure();
      _showError('Incorrect PIN. Try again.');
      _pinController.clear();
      _startCooldownTicker();
    }
  }

  /// Runs a KDF-bound operation with the progress state set.
  Future<T?> _runWork<T>(Future<T> Function() action) async {
    if (mounted) setState(() => _working = true);
    try {
      return await action();
    } finally {
      if (mounted) setState(() => _working = false);
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
    final seconds = math.max(
      1,
      remaining.inSeconds + (remaining.inMilliseconds % 1000 == 0 ? 0 : 1),
    );
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

  String get _headline {
    if (_settingUp) {
      return _firstPin == null ? 'Create your 4-digit PIN' : 'Confirm your PIN';
    }
    if (_upgrading) return 'Security upgrade';
    return widget.title;
  }

  String get _subhead {
    if (_settingUp) {
      return 'This PIN is stored only in device secure storage, salted and '
          'stretched so a stolen device cannot reverse it.';
    }
    if (_upgrading) {
      return 'We have improved how your PIN is protected. Enter your existing '
          'PIN once and it will be re-saved under the stronger scheme.';
    }
    return 'Enter your PIN to view private family information.';
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
                        Icon(
                          _upgrading
                              ? Icons.shield_moon_rounded
                              : Icons.lock_rounded,
                          size: 42,
                        ),
                        const SizedBox(height: 14),
                        Text(
                          _headline,
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _subhead,
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
                            enabled: !_working,
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
                        // Deriving the key takes a beat. Say so, or the screen
                        // looks like it ignored the fourth digit.
                        SizedBox(
                          height: 34,
                          child: _working
                              ? Padding(
                                  padding: const EdgeInsets.only(top: 14),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      const SizedBox(
                                        width: 14,
                                        height: 14,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Text(
                                        'Checking…',
                                        style: theme.textTheme.bodySmall
                                            ?.copyWith(color: Colors.white60),
                                      ),
                                    ],
                                  ),
                                )
                              : null,
                        ),
                        if (widget.canCancel) ...[
                          const SizedBox(height: 8),
                          TextButton(
                            onPressed: _working
                                ? null
                                : () => Navigator.of(context).pop(false),
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
