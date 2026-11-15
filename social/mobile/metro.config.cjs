// The avatar artwork is shared with Rider Comms (shared/src/avatars.ts), so
// Metro must be able to read that one folder outside this app.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../shared/src')];

module.exports = config;
