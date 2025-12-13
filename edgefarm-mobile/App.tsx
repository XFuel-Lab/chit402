import React from 'react'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Ionicons } from '@expo/vector-icons'
import { neon } from './src/theme/neon'
import { HomeScreen } from './src/screens/HomeScreen'
import { PoolsScreen } from './src/screens/PoolsScreen'
import { SwapScreen } from './src/screens/SwapScreen'
import { ProfileScreen } from './src/screens/ProfileScreen'

type TabParamList = {
  Home: undefined
  Pools: undefined
  Swap: undefined
  Profile: undefined
}

const Tab = createBottomTabNavigator<TabParamList>()

export default function App() {
  return (
    <NavigationContainer
      theme={{
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: neon.purple,
          background: neon.bg0,
          card: neon.bg1,
          text: neon.text,
          border: 'rgba(168, 85, 247, 0.20)',
          notification: neon.pink,
        },
      }}
    >
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: neon.blue,
          tabBarInactiveTintColor: 'rgba(255,255,255,0.50)',
          tabBarStyle: {
            backgroundColor: 'rgba(10, 10, 20, 0.92)',
            borderTopColor: 'rgba(168, 85, 247, 0.18)',
            height: 66,
            paddingTop: 8,
            paddingBottom: 10,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarIcon: ({ color, size }) => {
            const icon = (() => {
              switch (route.name) {
                case 'Home':
                  return 'home'
                case 'Pools':
                  return 'trophy'
                case 'Swap':
                  return 'swap-horizontal'
                case 'Profile':
                  return 'person'
                default:
                  return 'ellipse'
              }
            })()
            return <Ionicons name={icon as any} size={size} color={color} />
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Pools" component={PoolsScreen} />
        <Tab.Screen name="Swap" component={SwapScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  )
}
