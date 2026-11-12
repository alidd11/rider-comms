const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidColors, withAndroidColorsNight, withDangerousMod } = require('@expo/config-plugins');
const palette = require('../src/themePalette.json');

// The app's palette as Android colour resources: values/ for light,
// values-night/ for dark. src/theme.ts reads them with
// PlatformColor('@color/rider_…'), which React Native resolves against the
// current configuration, so Android follows the system theme the way
// DynamicColorIOS does on iOS.
const resourceName = (token) => `rider_${token.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;

function assign(colors, values) {
  return Object.entries(values).reduce(
    (result, [token, value]) => AndroidConfig.Colors.assignColorValue(result, { name: resourceName(token), value }),
    colors,
  );
}

module.exports = function withAndroidThemeColors(config) {
  config = withAndroidColors(config, (next) => {
    next.modResults = assign(next.modResults, palette.light);
    return next;
  });
  config = withAndroidColorsNight(config, (next) => {
    next.modResults = assign(next.modResults, palette.dark);
    return next;
  });
  // Nothing references these by R.color, only by name at runtime, so tell
  // resource shrinking to keep them.
  return withDangerousMod(config, ['android', async (next) => {
    const raw = path.join(next.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
    fs.mkdirSync(raw, { recursive: true });
    fs.writeFileSync(
      path.join(raw, 'rider_keep_colors.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@color/rider_*" />\n',
    );
    return next;
  }]);
};

module.exports.resourceName = resourceName;
