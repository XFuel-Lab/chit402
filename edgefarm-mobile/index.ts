// CRITICAL: Import polyfills in correct order
import 'react-native-get-random-values' // Must be FIRST for crypto entropy
import './crypto-polyfill'
import '@ethersproject/shims'
import 'text-encoding-polyfill'

import 'react-native-gesture-handler'
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
