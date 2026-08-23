# Family Tracker Flutter scaffold

Mobile-only Flutter starter for iOS and Android. The main feature files are:

- `lib/main.dart` — Firebase bootstrap, dark theme, mobile app shell.
- `lib/tracker_map.dart` — Google Maps, Firestore live streams, location publishing, battery data, profile drawer.
- `lib/pin_gate.dart` — 4-digit Pinput lock, app lifecycle lock, inactivity timeout, cooldown, and Keychain/Keystore storage.
- `firestore.rules` — family-scoped read/write rules for live locations and route history.

## Setup commands

From this folder:

```powershell
flutter create --platforms=android,ios .
flutter pub get
dart run flutter_launcher_icons
dart pub global activate flutterfire_cli
flutterfire configure --platforms=android,ios
flutter run --dart-define=FAMILY_ID=your-family-id
```

`flutter create --platforms=android,ios .` adds only the native iOS/Android runners. Run `flutterfire configure` after creating or selecting the Firebase project so the native Firebase config is generated for both platforms.

## Native configuration

1. Enable Anonymous Authentication and Cloud Firestore in Firebase Console.
2. Add `firestore.rules` with the Firebase CLI:

```powershell
firebase login
firebase use your-firebase-project-id
firebase deploy --only firestore:rules
```

3. Add the Google Maps API key to both native apps.

Android: add this inside `<application>` in `android/app/src/main/AndroidManifest.xml`:

```xml
<meta-data
    android:name="com.google.android.geo.API_KEY"
    android:value="YOUR_ANDROID_MAPS_API_KEY" />
```

iOS: add the Maps SDK key in `ios/Runner/AppDelegate.swift` before `GeneratedPluginRegistrant.register(with: self)`:

```swift
GMSServices.provideAPIKey("YOUR_IOS_MAPS_API_KEY")
```

Also add `import GoogleMaps`, set iOS deployment target to 14.0+, and add `NSLocationWhenInUseUsageDescription` plus `NSLocationAlwaysAndWhenInUseUsageDescription` to `Info.plist`. For background updates, enable Background Modes > Location updates in Xcode and add the Android foreground-service location permissions/configuration.

4. Create a family member document at `families/{familyId}/members/{authUid}` for every authorized user. The map reads from the top-level `family_locations` collection and expects each document to include `familyId`, `memberId`, `displayName`, `latitude`, `longitude`, `batteryLevel`, and `updatedAt`.

## Privacy lock behavior

- `AppSecurityGate` requires the household PIN before the map can be viewed.
- The app locks again on `paused`, `detached`, or `resumed` lifecycle transitions.
- Any pointer interaction resets the configurable inactivity timer, currently 60 seconds.
- Tapping a family member or settings still opens a fresh PIN gate, so moving between private profiles cannot rely on a previous unlock.
- The current anonymous-session data model does not contain per-member PIN identities, so this build intentionally uses one household PIN. See the TODO in `lib/pin_gate.dart` before introducing per-profile PIN verification.
- PIN hashes are stored only through `flutter_secure_storage`; no `shared_preferences` dependency or plaintext PIN storage is used. A one-time migration handles the legacy secure-storage raw-PIN key if present.

## App icon assets

Add these high-resolution assets before running `dart run flutter_launcher_icons`:

- `assets/icon/family_tracker_icon.png` — 1024×1024 full icon.
- `assets/icon/family_tracker_icon_foreground.png` — transparent 1024×1024 adaptive foreground.

Keep important artwork inside the central 66% safe area so Android masks do not crop it. The full configuration is in `flutter_launcher_icons.yaml`.

## Git commands for `TheLuxs` / `preview`

From the repository root, use:

```powershell
git add flutter_app/pubspec.yaml flutter_app/flutter_launcher_icons.yaml flutter_app/lib/main.dart flutter_app/lib/pin_gate.dart flutter_app/lib/tracker_map.dart flutter_app/firestore.rules flutter_app/firebase.json flutter_app/README.md flutter_app/assets/icon/README.md
git commit -m "Harden family tracker privacy lock"
git push origin preview
```

If a remote is not configured yet, add `https://github.com/aranluxman/TheLuxs.git` as `origin` before pushing.
