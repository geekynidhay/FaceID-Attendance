# Apex Attendance - Native Expo Mobile App

A native Expo mobile application for Android & iOS designed for door entrance kiosks and coaching staff phones.

---

## What It Includes

- **Full Native Camera Permissions**: Directly requests and integrates Android and iOS native hardware camera access without any web browser restrictions.
- **Dynamic Backend Server Configurator**: A top bar with **⚙️ Server** button allowing you to switch between:
  - Local Coaching Wi-Fi IP (`http://192.168.1.4:4000`)
  - Cloudflare / Ngrok secure tunnel (`https://...trycloudflare.com`)
  - Live GitHub Pages site
- **Offline / Disconnect Recovery**: Automatic retry and error screens if the coaching PC is restarted or disconnected.
- **Persistent Storage**: Remembers the backend URL across app restarts via `@react-native-async-storage/async-storage`.

---

## How to Run on Your Mobile Phone (Android or iPhone)

### Step 1: Install Expo Go on Your Phone
- **Android**: Download **Expo Go** from Google Play Store.
- **iPhone**: Download **Expo Go** from App Store.

### Step 2: Start the Expo Development Server
In your terminal, navigate to the `mobile-attendance-app` folder and run:

```bash
cd "mobile-attendance-app"
npx expo start --tunnel
```
*(The `--tunnel` flag ensures your phone can connect even if it's on cellular data or different Wi-Fi bands).*

### Step 3: Scan the QR Code
1. A QR code will display in your terminal.
2. Open **Expo Go** (on Android, tap "Scan QR code"; on iPhone, open Camera app and point at the QR code).
3. The app will build and open directly on your mobile device!

---

## Building a Standalone Android APK (Installable .apk file)

When you're ready to create a permanent installable APK file for Android:
```bash
cd "mobile-attendance-app"
npx eas-cli login
npx eas-cli build -p android --profile preview
```
This generates a downloadable `.apk` file that can be installed on any Android phone or tablet mounted at the coaching entrance.
