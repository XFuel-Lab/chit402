const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add crypto and Node.js core module polyfills
config.resolver.extraNodeModules = {
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('stream-browserify'),
  events: require.resolve('events'),
  buffer: require.resolve('buffer'),
  process: require.resolve('process/browser'),
};

module.exports = config;

