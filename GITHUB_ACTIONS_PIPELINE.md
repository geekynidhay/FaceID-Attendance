# GitHub Actions CI/CD Pipeline Instructions

To enable automatic cloud APK builds directly on GitHub:

1. In your GitHub repository [https://github.com/geekynidhay/FaceID-Attendance](https://github.com/geekynidhay/FaceID-Attendance):
   - Go to **Actions** tab.
   - Click **"New workflow"** ➔ **"set up a workflow yourself"**.
2. Name the file `.github/workflows/build-apk.yml`.
3. Paste the following YAML configuration:

```yaml
name: Build Android APK Release

on:
  push:
    branches: [ "main" ]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    name: Build Android APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: gradle

      - name: Grant Execute Permission for Gradlew
        run: chmod +x android-kiosk-app/gradlew

      - name: Build Android Debug APK
        run: |
          cd android-kiosk-app
          ./gradlew assembleDebug --no-daemon

      - name: Upload APK Artifact
        uses: actions/upload-artifact@v4
        with:
          name: apex-attendance-app
          path: android-kiosk-app/app/build/outputs/apk/debug/app-debug.apk

      - name: Create GitHub Release with APK
        uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/heads/main')
        with:
          tag_name: v1.0.${{ github.run_number }}
          name: DOT-CMC Attendance App v1.0.${{ github.run_number }}
          body: |
            Automated Android Build for DOT-CMC Computer Center Attendance App.
            Download and install `app-debug.apk` directly on any staff phone.
          files: android-kiosk-app/app/build/outputs/apk/debug/app-debug.apk
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

4. Click **"Commit changes..."**.
5. Once committed, GitHub Actions will automatically compile the APK on every commit and create a downloadable `.apk` file under the **Releases** and **Actions** tabs.
