import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'pin_gate.dart';
import 'tracker_map.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  String? bootstrapError;
  try {
    await Firebase.initializeApp();
    if (FirebaseAuth.instance.currentUser == null) {
      await FirebaseAuth.instance.signInAnonymously();
    }
  } catch (error) {
    bootstrapError = error.toString();
  }

  runApp(FamilyTrackerApp(bootstrapError: bootstrapError));
}

class FamilyTrackerApp extends StatelessWidget {
  const FamilyTrackerApp({super.key, this.bootstrapError});

  final String? bootstrapError;

  @override
  Widget build(BuildContext context) {
    const mint = Color(0xFF78F2C3);
    final scheme = ColorScheme.fromSeed(
      seedColor: mint,
      brightness: Brightness.dark,
    );

    return MaterialApp(
      title: 'Family Tracker',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: scheme,
        scaffoldBackgroundColor: const Color(0xFF0B1413),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFF172826),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide.none,
          ),
        ),
      ),
      home: bootstrapError == null
          ? const AppSecurityGate(child: HomePage())
          : SetupRequiredPage(error: bootstrapError!),
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  static const familyId = String.fromEnvironment(
    'FAMILY_ID',
    defaultValue: 'demo-family',
  );

  @override
  Widget build(BuildContext context) {
    return TrackerMap(
      familyId: familyId,
    );
  }
}

class SetupRequiredPage extends StatelessWidget {
  const SetupRequiredPage({super.key, required this.error});

  final String error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_rounded, size: 56),
                const SizedBox(height: 20),
                Text(
                  'Connect Firebase to continue',
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                const Text(
                  'Run flutterfire configure, add the generated native Firebase files, and enable anonymous auth.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 18),
                SelectableText(
                  error,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.white54,
                      ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
