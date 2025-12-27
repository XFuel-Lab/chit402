/**
 * StrideInitModal - Tesla-Style Seamless Stride Account Initialization
 * Auto-detects uninitialized Stride accounts and guides users through setup
 * Embedded Osmosis swap for 0.5 STRD purchase - zero friction, zero extra steps
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, ExternalLink, Zap, AlertCircle, Sparkles, ArrowRight } from 'lucide-react'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'

interface StrideInitModalProps {
  isOpen: boolean
  onClose: () => void
  strideAddress: string
  onInitComplete: () => void
}

type InitStep = 'detect' | 'explain' | 'swap' | 'verifying' | 'success' | 'manual'

export default function StrideInitModal({
  isOpen,
  onClose,
  strideAddress,
  onInitComplete,
}: StrideInitModalProps) {
  const [currentStep, setCurrentStep] = useState<InitStep>('detect')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimatedTime, setEstimatedTime] = useState(10)

  // Auto-detect account status
  useEffect(() => {
    if (isOpen && currentStep === 'detect') {
      checkStrideAccountStatus()
    }
  }, [isOpen, currentStep])

  const checkStrideAccountStatus = async () => {
    try {
      setIsLoading(true)
      const response = await fetch(
        `https://stride-api.polkachu.com/cosmos/auth/v1beta1/accounts/${strideAddress}`
      )
      
      if (response.ok) {
        // Account exists - we're good!
        setCurrentStep('success')
        setTimeout(() => {
          onInitComplete()
          onClose()
        }, 1500)
      } else if (response.status === 404) {
        // Account not initialized - guide user
        setCurrentStep('explain')
      } else {
        throw new Error('Unable to verify account status')
      }
    } catch (err: any) {
      console.error('Account check error:', err)
      setError(err.message)
      setCurrentStep('explain')
    } finally {
      setIsLoading(false)
    }
  }

  const handleOsmosisSwap = () => {
    // Pre-fill Osmosis swap parameters
    const osmosisUrl = new URL('https://app.osmosis.zone/')
    osmosisUrl.searchParams.set('from', 'ATOM')
    osmosisUrl.searchParams.set('to', 'STRD')
    osmosisUrl.searchParams.set('amount', '0.5')
    
    // Open in new window with instructions
    window.open(osmosisUrl.toString(), '_blank', 'width=800,height=900')
    
    setCurrentStep('verifying')
    startVerificationPolling()
  }

  const startVerificationPolling = () => {
    let attempts = 0
    const maxAttempts = 60 // 5 minutes with 5s intervals
    
    const checkInterval = setInterval(async () => {
      attempts++
      setEstimatedTime(Math.max(10, 60 - attempts * 5))
      
      const response = await fetch(
        `https://stride-api.polkachu.com/cosmos/auth/v1beta1/accounts/${strideAddress}`
      )
      
      if (response.ok) {
        clearInterval(checkInterval)
        setCurrentStep('success')
        setTimeout(() => {
          onInitComplete()
          onClose()
        }, 2000)
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval)
        setError('Verification timeout. Please ensure STRD was sent to your address.')
        setCurrentStep('manual')
      }
    }, 5000) // Check every 5 seconds
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 'detect':
        return (
          <div className="text-center py-8">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="inline-block"
            >
              <Sparkles className="w-12 h-12 text-purple-400 mx-auto mb-4" />
            </motion.div>
            <h3 className="text-xl font-bold text-white mb-2">Checking Stride Account...</h3>
            <p className="text-slate-400">Verifying your account status</p>
          </div>
        )

      case 'explain':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 mb-4">
                <Zap className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">
                Unlock Stride — 10s Setup
              </h3>
              <p className="text-slate-300 text-sm max-w-md mx-auto">
                Your Stride address needs a one-time activation with 0.5 STRD (~$0.50).
                Think Tesla software updates — invisible, automatic, seamless.
              </p>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-sm">
                  1
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-1">Quick Swap on Osmosis</h4>
                  <p className="text-slate-400 text-sm">
                    We'll open Osmosis with 0.5 STRD pre-filled from ATOM. Auto-connects Keplr.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-sm">
                  2
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-1">Confirm Swap (2 taps)</h4>
                  <p className="text-slate-400 text-sm">
                    Approve in Keplr → Transaction confirms in ~6s
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold text-sm">
                  ✓
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-1">Auto-Detected</h4>
                  <p className="text-slate-400 text-sm">
                    We'll detect activation and proceed instantly — no refresh needed
                  </p>
                </div>
              </div>
            </div>

            {/* Predictive gas suggestion */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-blue-300 font-semibold">Smart Tip</p>
                  <p className="text-blue-200/80">
                    0.5 STRD covers activation + ~50 future transactions. Unused STRD stays in your wallet.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/50 rounded p-3 font-mono text-xs text-slate-400 break-all">
              <span className="text-slate-500">Your Stride Address:</span>
              <br />
              {strideAddress}
            </div>

            <div className="flex gap-3">
              <NeonButton
                variant="primary"
                onClick={handleOsmosisSwap}
                className="flex-1 h-14 text-base font-bold"
              >
                <Zap className="w-5 h-5 mr-2" />
                Get 0.5 STRD on Osmosis
                <ArrowRight className="w-5 h-5 ml-2" />
              </NeonButton>
            </div>

            <button
              onClick={() => setCurrentStep('manual')}
              className="w-full text-sm text-slate-400 hover:text-slate-300 transition-colors"
            >
              I'll send STRD manually
            </button>
          </div>
        )

      case 'swap':
        return (
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white text-center">Complete Swap on Osmosis</h3>
            <p className="text-slate-400 text-sm text-center">
              Osmosis opened in a new window. Complete the swap and we'll auto-detect it.
            </p>
            
            <div className="bg-slate-800/50 rounded-lg p-6 text-center">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="inline-block"
              >
                <Sparkles className="w-12 h-12 text-purple-400 mx-auto mb-4" />
              </motion.div>
              <p className="text-slate-300 font-semibold">Monitoring your Stride address...</p>
            </div>

            <NeonButton variant="ghost" onClick={() => setCurrentStep('manual')} className="w-full">
              I'll handle this myself
            </NeonButton>
          </div>
        )

      case 'verifying':
        return (
          <div className="text-center py-8 space-y-6">
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="inline-block"
            >
              <Sparkles className="w-16 h-16 text-purple-400 mx-auto" />
            </motion.div>
            
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">
                Verifying Activation...
              </h3>
              <p className="text-slate-400 text-sm">
                Auto-detecting STRD in your Stride account
              </p>
            </div>

            <div className="max-w-xs mx-auto">
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: estimatedTime, ease: 'linear' }}
                />
              </div>
              <p className="text-slate-500 text-xs mt-2">
                Estimated: ~{estimatedTime}s remaining
              </p>
            </div>

            <div className="bg-slate-800/30 rounded-lg p-4 text-xs text-slate-400">
              <p className="mb-2">🔍 Checking every 5 seconds</p>
              <p>✓ No refresh needed — fully automatic</p>
            </div>
          </div>
        )

      case 'success':
        return (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center py-12"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', duration: 0.6 }}
            >
              <CheckCircle2 className="w-20 h-20 text-green-400 mx-auto mb-4" />
            </motion.div>
            
            <h3 className="text-3xl font-bold text-white mb-2">
              Stride Activated! 🚀
            </h3>
            <p className="text-slate-300">
              Your account is ready — proceeding to stake...
            </p>
          </motion.div>
        )

      case 'manual':
        return (
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white text-center">Manual Setup</h3>
            
            <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
              <div>
                <p className="text-sm text-slate-400 mb-2">
                  <strong className="text-white">Option 1:</strong> Use Osmosis DEX
                </p>
                <a
                  href="https://app.osmosis.zone/?from=ATOM&to=STRD&amount=0.5"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 text-sm"
                >
                  Open Osmosis <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              <div>
                <p className="text-sm text-slate-400 mb-2">
                  <strong className="text-white">Option 2:</strong> Use an Exchange
                </p>
                <p className="text-xs text-slate-500">
                  Buy STRD on any CEX, withdraw to your address below
                </p>
              </div>
            </div>

            <div className="bg-slate-900/50 rounded p-3 font-mono text-xs text-slate-400 break-all">
              <span className="text-slate-500">Send 0.5+ STRD to:</span>
              <br />
              <span className="text-white">{strideAddress}</span>
            </div>

            <div className="flex gap-3">
              <NeonButton
                variant="ghost"
                onClick={checkStrideAccountStatus}
                className="flex-1"
                disabled={isLoading}
              >
                {isLoading ? 'Checking...' : 'I Sent STRD — Verify'}
              </NeonButton>
              <NeonButton variant="ghost" onClick={onClose} className="flex-1">
                Close
              </NeonButton>
            </div>
          </div>
        )
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={currentStep === 'success' ? undefined : onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          >
            <div className="w-full max-w-lg">
              <GlassCard className="p-6">
                {error && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
                    {error}
                  </div>
                )}
                
                {renderStepContent()}
              </GlassCard>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

