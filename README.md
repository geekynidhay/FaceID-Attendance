# DOT-CMC FaceID Attendance & WhatsApp Notification System

A complete facial-recognition attendance solution for **DOT-CMC Computer Center** with automated bilingual (English + Hindi) WhatsApp notifications to parents via a self-hosted OpenWA gateway.

---

## 🌟 Key Features

1. **AI Face Recognition Kiosk**:
   - High-precision 128-dimensional neural facial feature vector extraction using Face-API.js.
   - Works on any PC webcam, tablet, or mobile phone.

2. **Automated WhatsApp Attendance Alerts (via OpenWA)**:
   - **Entry Alert**: Triggers when a student enters the institute.
   - **Leave Alert**: Triggers when a student checks out, complete with an interactive confirmation popup (`YES, LEAVING` / `NO, CANCEL`) to prevent accidental departures.
   - Anti-duplicate lock ensures parents never receive repeated burst messages.

3. **Message Template (Bilingual)**:
   ```text
   🔔 *DOT-CMC Computer Center*

   Dear Parent,
   *Rahul Sharma* has entered the institute at *10:30 AM*.

   प्रिय अभिभावक,
   *Rahul Sharma* संस्थान में *10:30 AM* पर उपस्थित हो गए हैं।
   ```

4. **Multi-Platform Support**:
   - **Desktop Web Portal**: Full-width dashboard with live check-in feed, student registration, and audit history.
   - **Android Native App (`android-kiosk-app`)**: Native Android Studio project targeting Samsung S24 & Android tablets with direct hardware camera access and front/back camera toggling.
   - **PWA / GitHub Pages (`gh-pages-distribution`)**: Installable Progressive Web App ready for free HTTPS hosting.

---

## 📁 Repository Structure

```
├── attendance-app/          # Core Node.js + Express Attendance Backend & Web UI
│   ├── public/              # Web & Mobile UI assets, Face-API models, Service Worker
│   ├── database.js          # SQLite database setup (students & attendance logs)
│   ├── whatsapp.js          # OpenWA REST API integration & bilingual templates
│   └── server.js            # Express server (Port 4000)
│
├── android-kiosk-app/       # Native Android Studio Project (Java, WebKit)
│   ├── app/src/main/        # Native Android app source code & manifest
│   └── build.gradle         # Gradle build configurations
│
├── gh-pages-distribution/   # Static PWA bundle ready for GitHub Pages hosting
│
└── openwa-service/          # Self-hosted WhatsApp Gateway (NestJS)
```

---

## 🚀 Quick Start Guide

### 1. Start the Attendance Server
```bash
cd attendance-app
npm install
node server.js
```
The server will run at `http://localhost:4000`.

### 2. Start the WhatsApp Gateway (OpenWA)
```bash
cd openwa-service
npm install
npm run start
```
1. Open the dashboard at `http://localhost:2785`.
2. Link your institute's WhatsApp number by scanning the QR code.

### 3. Run the Native Android App (Samsung S24 / Tablets)
1. Open the `android-kiosk-app` directory in **Android Studio**.
2. Connect your device via USB (with USB Debugging enabled).
3. Click the green **Run (▶)** button to install and launch directly on your device.
