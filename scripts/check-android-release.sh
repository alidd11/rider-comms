#!/usr/bin/env bash
# Google Play checks on the release APK built in CI (native-builds.yml):
# - 16 KB memory pages: apps targeting Android 15+ must ship native
#   libraries whose LOAD segments are 16 KB aligned, stored 16 KB aligned in
#   the archive. A dependency update that brings an old .so breaks this.
# - Target API level, and that the merged manifest keeps only the
#   permissions the store answers in APP_REVIEW.md describe.
set -euo pipefail

apk="${1:?usage: check-android-release.sh path/to/app-release.apk}"
min_target_sdk=36
build_tools="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -n 1)"
failures=()

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -q "$apk" 'lib/*' -d "$work" 2>/dev/null || true
libs=$(find "$work/lib" -name '*.so' \( -path '*/arm64-v8a/*' -o -path '*/x86_64/*' \) 2>/dev/null | sort)
[ -n "$libs" ] || failures+=("no 64-bit native libraries found in $apk")
for lib in $libs; do
  for align in $(readelf -lW "$lib" | awk '$1 == "LOAD" { print $NF }'); do
    if (( align < 0x4000 )); then
      failures+=("${lib#"$work"/} has a ${align} LOAD alignment; Play needs 16 KB (0x4000)")
      break
    fi
  done
done
echo "Checked $(echo "$libs" | grep -c .) 64-bit native libraries for 16 KB alignment"

if ! "$build_tools/zipalign" -c -P 16 4 "$apk" > /dev/null 2>&1; then
  failures+=("native libraries aren't stored 16 KB aligned in the APK (zipalign -c -P 16)")
fi

badging="$("$build_tools/aapt2" dump badging "$apk")"
target_sdk="$(sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p" <<< "$badging")"
echo "targetSdkVersion: $target_sdk"
(( target_sdk >= min_target_sdk )) || failures+=("targetSdkVersion $target_sdk is below Play's required $min_target_sdk")

permissions="$("$build_tools/aapt2" dump permissions "$apk")"
for required in RECORD_AUDIO ACCESS_FINE_LOCATION FOREGROUND_SERVICE_MICROPHONE FOREGROUND_SERVICE_LOCATION POST_NOTIFICATIONS BLUETOOTH_CONNECT; do
  grep -q "android.permission.$required'" <<< "$permissions" || failures+=("missing permission $required")
done
for blocked in ACCESS_BACKGROUND_LOCATION CAMERA READ_EXTERNAL_STORAGE WRITE_EXTERNAL_STORAGE SYSTEM_ALERT_WINDOW READ_MEDIA_IMAGES READ_MEDIA_VIDEO QUERY_ALL_PACKAGES; do
  if grep -q "android.permission.$blocked'" <<< "$permissions"; then
    failures+=("$blocked is in the manifest but the store answers say the app doesn't use it")
  fi
done

if (( ${#failures[@]} > 0 )); then
  printf '::error title=Android release check::%s\n' "${failures[@]}"
  exit 1
fi
echo "Android release APK meets the 16 KB, target API and permission checks"
