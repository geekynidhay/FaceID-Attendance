# DOT-CMC Automated Build Pipeline (GitHub Actions)

This pipeline automatically compiles:
1. **`DOT-CMC-Staff-Phone-APK`** (`app-release.apk`) — Android APK signed with v2/v3 signatures for staff phones.
2. **`DOT-CMC-Windows-Installer`** (`DOT-CMC-Setup.exe`) — Turnkey desktop installer for Windows coaching PCs.

---

### Step 1: Add the Pipeline File on GitHub Web

Because GitHub Personal Access Tokens (PATs) require explicit `workflow` permissions to create files inside `.github/workflows/`, you can add this file directly in your browser:

1. Open your repository on GitHub:
   👉 **[https://github.com/geekynidhay/FaceID-Attendance](https://github.com/geekynidhay/FaceID-Attendance)**
2. Click **Add file** ➔ **Create new file**.
3. In the filename box, type:
   ```
   .github/workflows/build-all.yml
   ```
4. Paste the workflow YAML below into the editor.
5. Click **Commit changes...** ➔ **Commit changes**.

---

### Complete Workflow YAML (`.github/workflows/build-all.yml`):

```yaml
name: Build DOT-CMC Applications (Android APK & Windows EXE)

on:
  push:
    branches: [ main ]
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  # ====================================================
  # 1. BUILD SIGNED ANDROID RELEASE APK
  # ====================================================
  build-android:
    name: Build Android APK
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
          cache: 'gradle'

      - name: Grant Execute Permission to Gradlew
        run: chmod +x android-kiosk-app/gradlew

      - name: Build Signed Release APK
        run: |
          cd android-kiosk-app
          ./gradlew assembleRelease --no-daemon

      - name: Upload Android APK
        uses: actions/upload-artifact@v4
        with:
          name: DOT-CMC-Staff-Phone-APK
          path: android-kiosk-app/app/build/outputs/apk/release/app-release.apk
          if-no-files-found: error

  # ====================================================
  # 2. BUILD WINDOWS DESKTOP INSTALLER (.EXE)
  # ====================================================
  build-windows-exe:
    name: Build Windows Desktop Installer (.exe)
    runs-on: windows-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: attendance-app/package.json

      - name: Install Project Dependencies
        run: |
          cd attendance-app
          npm install

      - name: Package Desktop Installer (.exe)
        run: |
          cd attendance-app
          npm run dist:win
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload Windows EXE
        uses: actions/upload-artifact@v4
        with:
          name: DOT-CMC-Windows-Installer
          path: attendance-app/dist-electron/*.exe
          if-no-files-found: error
```

---

### Step 2: Download Your Built Apps
Whenever you push changes or click **Run workflow** under the **Actions** tab on GitHub:
- Both jobs will run simultaneously on GitHub's cloud servers.
- When finished, go to the **Actions** tab ➔ Click the latest workflow run ➔ Scroll to **Artifacts**:
  - 📥 **`DOT-CMC-Staff-Phone-APK`** (`app-release.apk`)
  - 📥 **`DOT-CMC-Windows-Installer`** (`DOT-CMC-Setup.exe`)
