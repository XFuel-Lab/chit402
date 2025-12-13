module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'nativewind/babel',
      // Keep this plugin LAST
      'react-native-reanimated/plugin',
    ],
  }
}
