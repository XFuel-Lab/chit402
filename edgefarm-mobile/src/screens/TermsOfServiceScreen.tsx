import React from 'react'
import { ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { type } from '../theme/typography'
import { NeonButton } from '../components/NeonButton'

export function TermsOfServiceScreen() {
  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
          <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)', marginBottom: 8 }}>
            Terms of Service
          </Text>
          <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)', marginBottom: 24 }}>
            Last updated: {new Date().toLocaleDateString()}
          </Text>

          <NeonCard className="mb-4">
            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Acceptance of Terms
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              By accessing and using XFUEL Protocol ("the Service"), you accept and agree to be bound by these
              Terms of Service. If you do not agree, do not use the Service.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Description of Service
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              XFUEL Protocol provides a decentralized finance platform for swapping, staking, and managing
              liquid staking tokens on Theta blockchain. The Service facilitates on-chain transactions but
              does not hold or custody your assets.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              User Responsibilities
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 8 }}>
              • You are responsible for maintaining the security of your wallet and private keys
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 8 }}>
              • You must comply with all applicable laws and regulations
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              • You acknowledge that blockchain transactions are irreversible
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Risks and Disclaimers
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              Cryptocurrency and DeFi activities involve substantial risk. You may lose funds due to market
              volatility, smart contract bugs, or user error. We provide the Service "as is" without warranties.
              Use at your own risk.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Limitation of Liability
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              To the maximum extent permitted by law, XFUEL Protocol and its operators are not liable for any
              losses, damages, or claims arising from your use of the Service.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Prohibited Activities
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 8 }}>
              • Money laundering or terrorist financing
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 8 }}>
              • Fraudulent or illegal activities
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              • Attempting to exploit smart contract vulnerabilities
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Modifications to Terms
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              We reserve the right to modify these Terms at any time. Continued use after changes constitutes
              acceptance. We will notify users of material changes.
            </Text>

            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Contact Information
            </Text>
            <Text style={{ ...type.body, color: 'rgba(226,232,240,0.9)', lineHeight: 22, marginBottom: 16 }}>
              For questions about these Terms, contact us at legal@xfuel.app
            </Text>

            <View style={{ marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.8)', fontStyle: 'italic' }}>
                This is a placeholder terms of service. Please review and update with your legal team before
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


