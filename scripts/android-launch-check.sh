#!/usr/bin/env bash
# Run by the Native builds workflow inside a booted Android emulator: install
# the release APK, launch Rider Comms, and fail if it is not running 30 s
# later, putting the crash log into a GitHub annotation. Saves a screenshot
# as android-launch.png either way.
set -euo pipefail

apk="mobile/android/app/build/outputs/apk/release/app-release.apk"
package="com.ridercomms.app"

adb install -r "$apk"
adb logcat -c
adb shell monkey -p "$package" -c android.intent.category.LAUNCHER 1 > /dev/null
sleep 30
adb exec-out screencap -p > android-launch.png || true

crash="$(adb logcat -d -b crash | grep -A 40 "$package" | head -n 40 || true)"
if ! adb shell pidof "$package" > /dev/null || [ -n "$crash" ]; then
  echo "::error title=Android app crashed on launch::${crash//$'\n'/%0A}"
  exit 1
fi
echo "::notice title=Android launch::Rider Comms is running 30 s after launch (API $(adb shell getprop ro.build.version.sdk | tr -d '\r'))"
