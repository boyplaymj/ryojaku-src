# TuanTuan Mobile App Deployment Guide

This guide explains how to turn your React web app into a native iOS and Android app using **Capacitor**.

## Prerequisites

1.  **Node.js** installed on your computer.
2.  **Xcode** (for iOS) - Requires a Mac.
3.  **Android Studio** (for Android).
4.  **Developer Accounts**:
    *   Apple Developer Program ($99/year)
    *   Google Play Console ($25 one-time fee)

---

## Step 1: Install Capacitor

In your project terminal (VS Code), run these commands:

```bash
# Install Capacitor core and CLI
npm install @capacitor/core @capacitor/cli

# Initialize Capacitor (Name: TuanTuan, ID: com.tuantuan.app)
npx cap init TuanTuan com.tuantuan.app

# Install Android and iOS platforms
npm install @capacitor/android @capacitor/ios
```

## Step 2: Build the Web App

Before creating the mobile app, we need to build the React project into static HTML/JS files.

```bash
# Build your project (this creates a 'dist' or 'build' folder)
npm run build
```

*Note: Ensure your `capacitor.config.json` has `"webDir": "dist"` (or "build" depending on your bundler).*

## Step 3: Add Native Platforms

```bash
# Add Android platform
npx cap add android

# Add iOS platform
npx cap add ios
```

## Step 4: Sync and Open

Every time you update your React code, run `npm run build` then `npx cap sync`.

```bash
# Sync web code to native platforms
npx cap sync

# Open Android Studio
npx cap open android

# Open Xcode (iOS)
npx cap open ios
```

---

## Step 5: Configure Native Features (Push Notifications)

To make the "Push Notifications" feature work natively:

1.  Install the plugin:
    ```bash
    npm install @capacitor/push-notifications
    npx cap sync
    ```
2.  **Android**: Register your app on Firebase Console, download `google-services.json`, and place it in `android/app/`.
3.  **iOS**: Enable "Push Notifications" in Xcode under "Signing & Capabilities".

---

## Step 6: Store Upload

### Android (Google Play)
1.  In Android Studio: `Build` -> `Generate Signed Bundle / APK`.
2.  Create a Keystore (keep it safe!).
3.  Generate the `.aab` file.
4.  Upload to [Google Play Console](https://play.google.com/console).

### iOS (App Store)
1.  In Xcode: Select "Any iOS Device (arm64)".
2.  Product -> Archive.
3.  Once finished, the Organizer window opens. Click "Distribute App".
4.  Select "App Store Connect" and follow the prompts to upload.
5.  Submit for review in [App Store Connect](https://appstoreconnect.apple.com).

---

## Design & Assets

*   **App Icon**: Replace the default Capacitor icons in `android/app/src/main/res` and `ios/App/App/Assets.xcassets` with your own high-res logo.
*   **Splash Screen**: Configure the `capacitor-splash-screen` plugin to match the dark theme (`#020617`).

Happy Coding! 🚀
