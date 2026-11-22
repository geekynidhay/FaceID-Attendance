# Smart Coaching Face Attendance System with WhatsApp Integration

A complete face-recognition-based student attendance solution with automated WhatsApp notifications to parents via OpenWA.

---

## Architecture Overview

```
                                      ┌────────────────────────┐
                                      │  Student Entry / Kiosk │
                                      │ (PC Webcam or Mobile)  │
                                      └───────────┬────────────┘
                                                  │
                                                  ▼
                                      ┌────────────────────────┐
                                      │  Face-API.js (Browser) │
                                      │ 128-d Vector Matching  │
                                      └───────────┬────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────┐   HTTP POST   ┌────────────────────────┐
│     Parent's Phone              │ ◄──────────── │ Attendance Node Server │
│  "Rahul has entered coaching"   │   /api/mark   │   (Port 4000, SQLite)  │
└─────────────────────────────────┘               └───────────┬────────────┘
                ▲                                             │
                │                                             ▼
                │                          ┌────────────────────────┐
                └──────────────────────────┤   OpenWA Gateway       │
                      WhatsApp Session     │      (Port 2785)       │
                                           └────────────────────────┘
```

---

## 1. Quick URLs

* **Attendance Web Portal & Kiosk**: [http://localhost:4000](http://localhost:4000)
* **Mobile Access (over local Wi-Fi)**: `http://192.168.1.4:4000`
* **OpenWA Dashboard (once running)**: [http://localhost:2785](http://localhost:2785)

---

## 2. Running the System on your PC (Option A)

### Step 1: Start the Attendance Application
Open your terminal and run:
```bash
cd "attendance-app"
node server.js
```
The server will start on port `4000`.

### Step 2: OpenWA Setup (WhatsApp Gateway)
OpenWA runs in the `openwa-service` directory.
1. Open a new terminal:
```bash
cd "openwa-service"
npm install
npm run start
```
2. Open the OpenWA web dashboard at `http://localhost:2785`.
3. Create a session named `attendance-bot`.
4. Scan the QR code with WhatsApp from your coaching institute's phone (**WhatsApp -> Linked Devices -> Link a Device**).

---

## 3. Features Implemented

1. **Responsive Web & Mobile Interface**:
   - Works on both desktop PC webcams and mobile/tablet browsers.
   - Entrance Kiosk Mode with laser-scanner overlay animation and audio chime confirmation.
   - Camera flip support (front/rear cameras on phones).

2. **128-d Neural Face Recognition (face-api.js)**:
   - On-device local inference using `tiny_face_detector`, `face_landmark_68`, and `face_recognition`.
   - Privacy-preserving: extracts 128-dimension feature embeddings stored in SQLite.

3. **Student Registration**:
   - Capture student name, roll number, batch, and parent's WhatsApp number.
   - Extracts and saves facial vectors instantly via camera snapshot.

4. **Rate Safety & Spam Protection**:
   - 15-minute anti-burst cooldown per student to prevent repeated duplicate WhatsApp notifications if a student lingers before the camera.
   - Handles the 3-students-per-minute traffic without latency or queuing issues.

5. **Live Attendance History Table**:
   - Live view of today's check-ins, exact time, parent phone number, and WhatsApp delivery status.
