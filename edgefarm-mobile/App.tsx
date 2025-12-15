import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, NavigationContainer } from '@react-navigation/native'
import { createMaterialTopTabNavigator, MaterialTopTabBarProps } from '@react-navigation/material-top-tabs'
import { Ionicons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import { useFonts } from 'expo-font'
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter'
import { Orbitron_600SemiBold, Orbitron_700Bold } from '@expo-google-fonts/orbitron'
import { neon } from './src/theme/neon'
import { HomeScreen } from './src/screens/HomeScreen'
import { MiningScreen } from './src/screens/MiningScreen'
import { PoolsScreen } from './src/screens/PoolsScreen'
import { SwapScreen } from './src/screens/SwapScreen'
import { ProfileScreen } from './src/screens/ProfileScreen'
import { OnboardingScreen } from './src/screens/OnboardingScreen'
import { getHasSeenOnboarding, setHasSeenOnboarding } from './src/lib/onboarding'
import { type } from './src/theme/typography'
import { UiModeProvider } from './src/lib/uiMode'

type TabParamList = {
  Home: undefined
  Mining: undefined
  Pools: undefined
  Swap: undefined
  Profile: undefined
}

const Tab = createMaterialTopTabNavigator<TabParamList>()

export default function App() {
  const [hasSeen, setHasSeen] = useState<boolean | null>(null)

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Orbitron_600SemiBold,
    Orbitron_700Bold,
  })

  useEffect(() => {
    getHasSeenOnboarding().then(setHasSeen)
  }, [])

  const theme = useMemo(
    () => ({
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
    }),
    []
  )

  if (!fontsLoaded || hasSeen === null) return null

  return (
    <UiModeProvider>
      <NavigationContainer theme={theme}>
        <StatusBar style="light" />
        {hasSeen ? (
          <MainTabs />
        ) : (
          <OnboardingScreen
            onDone={async () => {
              await setHasSeenOnboarding()
              setHasSeen(true)
            }}
          />
        )}
      </NavigationContainer>
    </UiModeProvider>
  )
}

function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <BottomSwipeTabBar {...props} />}
      tabBarPosition="bottom"
      screenOptions={({ route }) => ({
        headerShown: false,
        swipeEnabled: true,
        animationEnabled: true,
        lazy: true,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Mining" component={MiningScreen} />
      <Tab.Screen name="Pools" component={PoolsScreen} />
      <Tab.Screen name="Swap" component={SwapScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  )
}

function BottomSwipeTabBar({ state, navigation }: MaterialTopTabBarProps) {
  const routes = state.routes
  const activeIndex = state.index

  return (
    <View
      style={{
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 12,
        height: 68,
        borderRadius: 22,
        overflow: 'hidden',
      }}
    >
      <BlurView intensity={22} tint="dark" style={{ flex: 1, backgroundColor: 'rgba(10,10,20,0.78)' }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
          {routes.map((route, idx) => {
            const focused = idx === activeIndex
            const color = focused ? neon.blue : 'rgba(255,255,255,0.45)'
            const icon = (() => {
              switch (route.name) {
                case 'Home':
                  return 'home'
                case 'Mining':
                  return 'hardware-chip'
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

            return (
              <Pressable
                key={route.key}
                onPress={() => navigation.navigate(route.name as never)}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}
              >
                <Ionicons name={icon as any} size={20} color={color} />
                <Text style={{ ...type.caption, fontSize: 11, color }}>{route.name}</Text>
              </Pressable>
            )
          })}
        </View>
      </BlurView>
    </View>
  )
}
