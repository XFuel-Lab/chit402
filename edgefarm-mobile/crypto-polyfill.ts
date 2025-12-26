// Global crypto polyfills for React Native
// CRITICAL: This must be imported FIRST before any crypto operations

// Buffer polyfill (must come before crypto-browserify)
if (typeof global.Buffer === 'undefined') {
  global.Buffer = require('buffer').Buffer;
}

// Ensure global.process exists (must come before crypto-browserify)
if (typeof global.process === 'undefined') {
  global.process = require('process');
  global.process.browser = true;
  global.process.version = 'v16.0.0'; // Fake version for compatibility
}

// Polyfill crypto for Node.js modules (without react-native-crypto which has issues)
if (typeof global.crypto === 'undefined') {
  const cryptoBrowserify = require('crypto-browserify');
  global.crypto = {
    ...cryptoBrowserify,
    getRandomValues: (array: any) => {
      // This is already polyfilled by react-native-get-random-values
      // Just pass through
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        return crypto.getRandomValues(array);
      }
      // Fallback
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
  };
}

// Polyfill EventEmitter for streams
if (typeof global.EventEmitter === 'undefined') {
  const { EventEmitter } = require('events');
  global.EventEmitter = EventEmitter;
}

// Polyfill stream
if (typeof global.stream === 'undefined') {
  global.stream = require('stream-browserify');
}

