import 'dart:convert';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pinput/pinput.dart';

class PinStore {
  PinStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  static const _pinHashKey = 'family_tracker_pin_hash';
  final FlutterSecureStorage _storage;

  Future<bool> hasPin() async => (await _storage.read(key: _pinHashKey)) != null;

  Future<void> savePin(String pin) async {
    await _storage.write(key: _pinHashKey, value: _hash(pin));
  }

  Future<bool> verify(String pin) async {
    final savedHash = await _storage.read(key: _pinHashKey);
    return savedHash != null && savedHash == _hash(pin);
  }

  String _hash(String pin) => sha256.convert(utf8.encode(pin)).toString();
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

class PinGate extends StatefulWidget {
  const PinGate({super.key, this.title = 'Unlock family details'});

  final String title;

  @override
  State<PinGate> createState() => _PinGateState();
}

class _PinGateState extends State<PinGate> with SingleTickerProviderStateMixin {
  final _pinStore = PinStore();
  final _pinController = TextEditingController();
  late final AnimationController _shakeController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 420),
  );

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
  }

  Future<void> _submit(String pin) async {
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
      if (mounted) Navigator.of(context).pop(true);
      return;
    }

    if (await _pinStore.verify(pin)) {
      if (mounted) Navigator.of(context).pop(true);
    } else {
      _showError('Incorrect PIN. Try again.');
      _pinController.clear();
    }
  }

  void _showError(String message) {
    _shakeController.forward(from: 0);
    if (!mounted) return;
    setState(() => _error = message);
  }

  @override
  void dispose() {
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
      borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          24,
          12,
          24,
          24 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: _loading
            ? const SizedBox(
                height: 220,
                child: Center(child: CircularProgressIndicator()),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 26),
                  const Icon(Icons.lock_rounded, size: 38),
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
                        ? 'This PIN is stored only on this device.'
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
                      final x = math.sin(_shakeController.value * math.pi * 6) *
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
                        if (_error != null) setState(() => _error = null);
                      },
                      onCompleted: _submit,
                    ),
                  ),
                  const SizedBox(height: 22),
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    child: const Text('Cancel'),
                  ),
                ],
              ),
      ),
    );
  }
}
