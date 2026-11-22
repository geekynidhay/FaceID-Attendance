# Deploying Face Attendance Frontend to GitHub Pages

The frontend in `gh-pages-distribution/` is completely static, HTTPS-compatible, and installable as a mobile application (PWA).

---

## 1. How GitHub Pages Works with Your System

```
┌─────────────────────────────────┐
│     GitHub Pages (HTTPS)        │
│   https://username.github.io    │
│  (Installable Mobile App / PWA) │
└────────────────┬────────────────┘
                 │
                 │ REST API Calls (Attendance, Reg, Face Descriptors)
                 ▼
┌─────────────────────────────────┐
│    Your Coaching PC Backend     │
│   (Node.js + OpenWA WhatsApp)   │
│ Exposed via Cloudflare / Ngrok  │
└─────────────────────────────────┘
```

Because **GitHub Pages provides automatic free HTTPS**, opening it on any mobile phone (Android or iPhone) will:
1. Allow full camera access with no browser security errors.
2. Allow you to tap **"Install App"** (or *Add to Home Screen*) so it acts as a standalone mobile app with its own icon on your phone's home screen.

---

## 2. Step-by-Step Deployment to GitHub Pages

1. Create a new GitHub repository (e.g. `apex-attendance`).
2. Push the contents of the `gh-pages-distribution/` folder to your GitHub repository:
   ```bash
   cd gh-pages-distribution
   git init
   git add .
   git commit -m "Initial commit for attendance frontend PWA"
   git branch -M main
   git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
   git push -u origin main
   ```
3. In your GitHub repository:
   - Go to **Settings** ➔ **Pages**.
   - Under **Build and deployment** ➔ **Branch**, select `main` and `/ (root)`.
   - Click **Save**.
4. GitHub will give you a live URL:  
   `https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPO_NAME>/`

---

## 3. Linking the GitHub Pages App to Your Coaching PC

Because GitHub Pages runs over `https://`, your local PC backend needs an HTTPS URL so the mobile app can reach it securely.

### Quick Free Option: Cloudflare Tunnel or Ngrok (No Port Forwarding Required)

Run either of these on your Mac:

#### Option A: Cloudflare Tunnel (Free, no account needed)
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:4000
```
It will output a link like `https://random-words.trycloudflare.com`.

#### Option B: Ngrok
```bash
brew install ngrok
ngrok http 4000
```
It will give you `https://xxxx.ngrok-free.app`.

### Configure in the App:
1. Open your GitHub Pages link on your phone.
2. Tap the **Gear icon (⚙️)** in the top navigation bar.
3. Paste your Cloudflare/Ngrok URL and tap **Save & Reconnect**.
4. Tap **Install App** to add it to your phone's home screen!
