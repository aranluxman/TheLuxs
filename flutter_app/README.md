# Family Tracker Flutter scaffold

Mobile-only Flutter starter for iOS and Android. The main feature files are:

- `lib/main.dart` — Firebase bootstrap, dark theme, mobile app shell.
- `lib/tracker_map.dart` — Google Maps, Firestore live streams, location publishing, battery data, profile drawer.
- `lib/pin_gate.dart` — 4-digit Pinput lock with incorrect-PIN shake state and Keychain/Keystore storage.
- `lib/paywall.dart` — `$4.99/month` Family Pro purchase flow using `in_app_purchase`.
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

## Store setup

Create the same product ID in App Store Connect and Google Play Console:

```text
Product ID: family_pro_monthly
Type: auto-renewable subscription / subscription
Price: $4.99 USD per month
```

Use sandbox/TestFlight and Play internal testing before release. The sample unlocks the UI after the store reports `purchased` or `restored`; production should verify Apple/Google receipts on a trusted server before granting entitlements.

## App icon assets

Add these high-resolution assets before running `dart run flutter_launcher_icons`:

- `assets/icon/family_tracker_icon.png` — 1024×1024 full icon.
- `assets/icon/family_tracker_icon_foreground.png` — transparent 1024×1024 adaptive foreground.

Keep important artwork inside the central 66% safe area so Android masks do not crop it. The full configuration is in `flutter_launcher_icons.yaml`.

## Git commands for `theluxs` / `preview`

These commands assume the GitHub repository URL is `https://github.com/theluxs/theluxs.git`:

```powershell
git init
git branch -M preview
git remote add origin https://github.com/theluxs/theluxs.git
git add pubspec.yaml flutter_launcher_icons.yaml lib/main.dart lib/pin_gate.dart lib/paywall.dart lib/tracker_map.dart firestore.rules firebase.json README.md assets/icon/README.md
git commit -m "Build mobile family location tracker"
git push -u origin preview
```

If a remote already exists, use `git remote set-url origin https://github.com/theluxs/theluxs.git` instead of `git remote add origin ...`.
