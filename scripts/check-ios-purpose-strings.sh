#!/usr/bin/env bash
# App Store Connect rejects an upload (ITMS-90683) when the app links a
# privacy-sensitive system framework without its purpose string, even if
# Rider Comms itself never calls it: an SDK linking it is enough. Checks the
# built simulator app (native-builds.yml) so a new dependency is caught here
# instead of at upload. Also confirms the privacy manifest is bundled.
set -euo pipefail

app="${1:?usage: check-ios-purpose-strings.sh path/to/RiderComms.app}"
plist="$app/Info.plist"
failures=()

frameworks="$(
  find "$app" -type f | while read -r file; do
    if file "$file" | grep -q 'Mach-O'; then otool -L "$file"; fi
  done | grep -o '/System/Library/Frameworks/[A-Za-z]*\.framework' | sed 's|.*/||; s|\.framework||' | sort -u
)"
echo "Linked system frameworks: $(echo $frameworks)"

has_key() { /usr/libexec/PlistBuddy -c "Print :$1" "$plist" > /dev/null 2>&1; }
require() {
  local framework="$1"; shift
  grep -qx "$framework" <<< "$frameworks" || return 0
  for key in "$@"; do
    has_key "$key" || failures+=("$framework is linked but Info.plist has no $key")
  done
}

require AVFoundation NSMicrophoneUsageDescription NSCameraUsageDescription
require CoreLocation NSLocationWhenInUseUsageDescription
require CoreBluetooth NSBluetoothAlwaysUsageDescription
require CoreMotion NSMotionUsageDescription
require Contacts NSContactsUsageDescription
require Photos NSPhotoLibraryUsageDescription
require Speech NSSpeechRecognitionUsageDescription
require LocalAuthentication NSFaceIDUsageDescription
require HealthKit NSHealthShareUsageDescription
require HomeKit NSHomeKitUsageDescription
require CoreNFC NFCReaderUsageDescription
require AppTrackingTransparency NSUserTrackingUsageDescription
if grep -qx EventKit <<< "$frameworks" && ! has_key NSCalendarsFullAccessUsageDescription && ! has_key NSCalendarsUsageDescription; then
  failures+=("EventKit is linked but Info.plist has no calendar purpose string")
fi

[ -f "$app/PrivacyInfo.xcprivacy" ] || failures+=("PrivacyInfo.xcprivacy isn't in the app bundle")

if (( ${#failures[@]} > 0 )); then
  printf '::error title=iOS purpose strings::%s\n' "${failures[@]}"
  exit 1
fi
echo "Every linked privacy-sensitive framework has its purpose string"
