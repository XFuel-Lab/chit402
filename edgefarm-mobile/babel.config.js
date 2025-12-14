module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      'babel-preset-expo',
      // NativeWind's Babel integration is a preset in some versions,
      // so we keep it in presets for compatibility.
      'nativewind/babel',
    ],
    plugins: [
      // Keep this plugin LAST
      'react-native-reanimated/plugin',
    ],
  }
}
