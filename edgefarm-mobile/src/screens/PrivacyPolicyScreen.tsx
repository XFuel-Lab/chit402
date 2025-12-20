import React from 'react'
import { ScrollView, Text, View, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { type } from '../theme/typography'
import { NeonButton } from '../components/NeonButton'

export function PrivacyPolicyScreen() {
  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
          <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)', marginBottom: 8 }}>
            Privacy Policy
          </Text>
          <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)', marginBottom: 24 }}>
            Last updated: {new Date().toLocaleDateString()}
          </Text>

          <NeonCard className="mb-4">
            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Introduction
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              XFUEL Protocol ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy
              explains how we collect, use, disclose, and safeguard your information when you use our mobile
              application and services.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Information We Collect
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 8 }}>
              • Wallet addresses and transaction data (stored locally on your device)
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 8 }}>
              • Device information and usage analytics (anonymized)
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              • No personal identification information is collected without your consent
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              How We Use Your Information
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              We use collected information to provide, maintain, and improve our services, process transactions,
              and ensure security. We do not sell or share your data with third parties for marketing purposes.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Blockchain Transparency
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              Transactions on Theta blockchain are public. Wallet addresses and transaction hashes are visible on
              the blockchain explorer. We cannot control or delete blockchain data.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Data Security
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              We implement industry-standard security measures. Private keys are stored locally on your device
              and never transmitted to our servers. You are responsible for securing your device and wallet.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Your Rights
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              You have the right to access, modify, or delete locally stored data through the app settings.
              You can disconnect your wallet at any time.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Contact Us
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              For questions about this Privacy Policy, contact us at privacy@xfuel.app
            </Text>

            <View style={{ marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.8)', fontStyle: 'italic' }}>
                This is a placeholder privacy policy. Please review and update with your legal team before
                App Store submission.
              </Text>
            </View>
          </NeonCard>

          <NeonButton
            label="Back"
            variant="secondary"
            onPress={() => {
              // Navigation handled by parent
            }}
          />
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}


