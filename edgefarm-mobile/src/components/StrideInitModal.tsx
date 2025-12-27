/**
 * StrideInitModal - Mobile-Optimized with Haptics & Animations
 * Reanimated pulse animations, tactile feedback, and gesture-driven UX
 */

import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
  Vibration,
} from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'

interface StrideInitModalProps {
  visible: boolean
  onClose: () => void
  strideAddress: string
  onInitComplete: () => void
}

type InitStep = 'detect' | 'explain' | 'verifying' | 'success' | 'manual'

export default function StrideInitModal({
  visible,
  onClose,
  strideAddress,
  onInitComplete,
}: StrideInitModalProps) {
  const [currentStep, setCurrentStep] = useState<InitStep>('detect')
  const [isLoading, setIsLoading] = useState(false)
  const [estimatedTime, setEstimatedTime] = useState(10)

  // Animation values
  const pulseScale = useSharedValue(1)
  const progressWidth = useSharedValue(0)
  const successScale = useSharedValue(0)

  // Auto-detect account status
  useEffect(() => {
    if (visible && currentStep === 'detect') {
      checkStrideAccountStatus()
    }
  }, [visible, currentStep])

  // Pulse animation for loading states
  useEffect(() => {
    if (currentStep === 'detect' || currentStep === 'verifying') {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      )
    }
  }, [currentStep])

  const checkStrideAccountStatus = async () => {
    try {
      setIsLoading(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      
      const response = await fetch(
        `https://stride-api.polkachu.com/cosmos/auth/v1beta1/accounts/${strideAddress}`
      )

      if (response.ok) {
        // Account exists!
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setCurrentStep('success')
        successScale.value = withSpring(1, { damping: 10, stiffness: 100 })
        
        setTimeout(() => {
          onInitComplete()
          onClose()
        }, 2000)
      } else if (response.status === 404) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        setCurrentStep('explain')
      }
    } catch (err) {
      console.error('Account check error:', err)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setCurrentStep('explain')
    } finally {
      setIsLoading(false)
    }
  }

  const handleOsmosisSwap = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    
    const osmosisUrl = `https://app.osmosis.zone/?from=ATOM&to=STRD&amount=0.5`
    const canOpen = await Linking.canOpenURL(osmosisUrl)
    
    if (canOpen) {
      await Linking.openURL(osmosisUrl)
      setCurrentStep('verifying')
      startVerificationPolling()
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      alert('Unable to open Osmosis. Please install a web browser.')
    }
  }

  const startVerificationPolling = () => {
    let attempts = 0
    const maxAttempts = 60

    progressWidth.value = withTiming(100, {
      duration: 60000, // 1 minute
      easing: Easing.linear,
    })

    const checkInterval = setInterval(async () => {
      attempts++
      setEstimatedTime(Math.max(10, 60 - attempts * 5))

      const response = await fetch(
        `https://stride-api.polkachu.com/cosmos/auth/v1beta1/accounts/${strideAddress}`
      )

      if (response.ok) {
        clearInterval(checkInterval)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        Vibration.vibrate([0, 100, 50, 100]) // Success pattern
        
        setCurrentStep('success')
        successScale.value = withSpring(1, { damping: 8, stiffness: 100 })
        
        setTimeout(() => {
          onInitComplete()
          onClose()
        }, 2000)
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        setCurrentStep('manual')
      }
    }, 5000)
  }

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }))

  const progressAnimatedStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }))

  const successAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
  }))

  const renderStepContent = () => {
    switch (currentStep) {
      case 'detect':
        return (
          <View className="items-center py-12">
            <Animated.View style={pulseAnimatedStyle}>
              <Ionicons name="sparkles" size={64} color="#a78bfa" />
            </Animated.View>
            <Text className="text-xl font-bold text-white mt-6 mb-2">
              Checking Stride Account...
            </Text>
            <Text className="text-slate-400 text-center">
              Verifying your account status
            </Text>
          </View>
        )

      case 'explain':
        return (
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="items-center mb-6">
              <View className="w-20 h-20 rounded-full bg-purple-500/20 items-center justify-center mb-4">
                <Ionicons name="flash" size={40} color="#a78bfa" />
              </View>
              <Text className="text-2xl font-bold text-white mb-3 text-center">
                Unlock Stride — 10s Setup
              </Text>
              <Text className="text-slate-300 text-center px-4">
                One-time activation with 0.5 STRD (~$0.50). Think Tesla updates — invisible, automatic.
              </Text>
            </View>

            {/* Step-by-step guide */}
            <View className="bg-slate-800/50 rounded-2xl p-4 mb-6">
              <View className="flex-row items-start mb-4">
                <View className="w-10 h-10 rounded-full bg-purple-500/20 items-center justify-center mr-3">
                  <Text className="text-purple-400 font-bold">1</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold mb-1">Quick Swap on Osmosis</Text>
                  <Text className="text-slate-400 text-sm">
                    Pre-filled with 0.5 STRD from ATOM. Auto-connects Keplr.
                  </Text>
                </View>
              </View>

              <View className="flex-row items-start mb-4">
                <View className="w-10 h-10 rounded-full bg-purple-500/20 items-center justify-center mr-3">
                  <Text className="text-purple-400 font-bold">2</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold mb-1">Confirm Swap (2 taps)</Text>
                  <Text className="text-slate-400 text-sm">
                    Approve in Keplr → Confirms in ~6s
                  </Text>
                </View>
              </View>

              <View className="flex-row items-start">
                <View className="w-10 h-10 rounded-full bg-green-500/20 items-center justify-center mr-3">
                  <Ionicons name="checkmark" size={20} color="#4ade80" />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold mb-1">Auto-Detected</Text>
                  <Text className="text-slate-400 text-sm">
                    We detect activation instantly — no refresh
                  </Text>
                </View>
              </View>
            </View>

            {/* Smart tip */}
            <View className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-4 mb-6">
              <View className="flex-row items-start">
                <Ionicons name="information-circle" size={20} color="#60a5fa" className="mr-2 mt-0.5" />
                <View className="flex-1 ml-2">
                  <Text className="text-blue-300 font-semibold mb-1">Smart Tip</Text>
                  <Text className="text-blue-200/80 text-sm">
                    0.5 STRD covers activation + ~50 transactions. Unused STRD stays in your wallet.
                  </Text>
                </View>
              </View>
            </View>

            {/* Address display */}
            <View className="bg-slate-900/50 rounded-xl p-4 mb-6">
              <Text className="text-slate-500 text-xs mb-2">Your Stride Address:</Text>
              <Text className="text-white font-mono text-xs" numberOfLines={2} ellipsizeMode="middle">
                {strideAddress}
              </Text>
            </View>

            {/* Action button */}
            <TouchableOpacity
              onPress={handleOsmosisSwap}
              className="bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl p-5 mb-4 active:opacity-80"
              activeOpacity={0.8}
            >
              <View className="flex-row items-center justify-center">
                <Ionicons name="flash" size={24} color="white" />
                <Text className="text-white text-lg font-bold ml-2 mr-2">
                  Get 0.5 STRD on Osmosis
                </Text>
                <Ionicons name="arrow-forward" size={24} color="white" />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setCurrentStep('manual')
              }}
              className="py-3"
            >
              <Text className="text-slate-400 text-center">I'll send STRD manually</Text>
            </TouchableOpacity>
          </ScrollView>
        )

      case 'verifying':
        return (
          <View className="items-center py-12">
            <Animated.View style={pulseAnimatedStyle}>
              <Ionicons name="sparkles" size={80} color="#a78bfa" />
            </Animated.View>

            <Text className="text-2xl font-bold text-white mt-8 mb-2">
              Verifying Activation...
            </Text>
            <Text className="text-slate-400 text-center mb-8">
              Auto-detecting STRD in your account
            </Text>

            {/* Progress bar */}
            <View className="w-full max-w-xs mb-4">
              <View className="h-3 bg-slate-800 rounded-full overflow-hidden">
                <Animated.View
                  style={progressAnimatedStyle}
                  className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                />
              </View>
              <Text className="text-slate-500 text-xs text-center mt-2">
                ~{estimatedTime}s remaining
              </Text>
            </View>

            <View className="bg-slate-800/30 rounded-xl p-4 mt-4">
              <Text className="text-slate-400 text-xs text-center mb-2">
                🔍 Checking every 5 seconds
              </Text>
              <Text className="text-slate-400 text-xs text-center">
                ✓ No refresh needed — fully automatic
              </Text>
            </View>
          </View>
        )

      case 'success':
        return (
          <View className="items-center py-16">
            <Animated.View style={successAnimatedStyle}>
              <Ionicons name="checkmark-circle" size={100} color="#4ade80" />
            </Animated.View>

            <Text className="text-3xl font-bold text-white mt-6 mb-2">
              Stride Activated! 🚀
            </Text>
            <Text className="text-slate-300 text-center">
              Your account is ready — proceeding to stake...
            </Text>
          </View>
        )

      case 'manual':
        return (
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <Text className="text-xl font-bold text-white text-center mb-6">
              Manual Setup
            </Text>

            <View className="bg-slate-800/50 rounded-2xl p-4 mb-6">
              <View className="mb-4">
                <Text className="text-slate-400 text-sm mb-2">
                  <Text className="text-white font-semibold">Option 1:</Text> Use Osmosis DEX
                </Text>
                <TouchableOpacity
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    Linking.openURL('https://app.osmosis.zone/?from=ATOM&to=STRD&amount=0.5')
                  }}
                  className="flex-row items-center"
                >
                  <Text className="text-purple-400 text-sm mr-2">Open Osmosis</Text>
                  <Ionicons name="open-outline" size={16} color="#a78bfa" />
                </TouchableOpacity>
              </View>

              <View>
                <Text className="text-slate-400 text-sm mb-1">
                  <Text className="text-white font-semibold">Option 2:</Text> Use an Exchange
                </Text>
                <Text className="text-slate-500 text-xs">
                  Buy STRD on any CEX, withdraw to your address below
                </Text>
              </View>
            </View>

            <View className="bg-slate-900/50 rounded-xl p-4 mb-6">
              <Text className="text-slate-500 text-xs mb-2">Send 0.5+ STRD to:</Text>
              <Text className="text-white font-mono text-xs" numberOfLines={3}>
                {strideAddress}
              </Text>
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                  checkStrideAccountStatus()
                }}
                disabled={isLoading}
                className="flex-1 bg-slate-700 rounded-2xl p-4 active:opacity-70"
              >
                <Text className="text-white text-center font-semibold">
                  {isLoading ? 'Checking...' : 'I Sent STRD — Verify'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  onClose()
                }}
                className="flex-1 bg-slate-800 rounded-2xl p-4 active:opacity-70"
              >
                <Text className="text-slate-300 text-center font-semibold">Close</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={currentStep === 'success' ? undefined : onClose}
    >
      <View className="flex-1 bg-black/90">
        <View className="flex-1 p-6 pt-16">
          <View className="flex-1 bg-slate-900/95 backdrop-blur-xl rounded-3xl p-6 border border-slate-700/50">
            {renderStepContent()}
          </View>
        </View>
      </View>
    </Modal>
  )
}

