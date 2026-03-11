import { useState } from 'react'
import { ethers } from 'ethers'

interface SignInModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress: string | null
  onConnectWallet: () => void
  onSignInSuccess: (alias: string, email?: string) => void
}

export default function SignInModal({
  isOpen,
  onClose,
  walletAddress,
  onConnectWallet,
  onSignInSuccess,
}: SignInModalProps) {
  const [email, setEmail] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSignIn = async () => {
    if (!walletAddress) {
      setError('Please connect your wallet first')
      return
    }

    setIsSigningIn(true)
    setError(null)

    try {
      // Request wallet signature (non-custodial authentication)
      const provider = new ethers.BrowserProvider(
        (window as any).ethereum || (window as any).theta,
      )
      const signer = await provider.getSigner()
      const message = `Sign in to XFUEL\n\nAddress: ${walletAddress}\nTimestamp: ${new Date().toISOString()}\n\nThis signature proves wallet ownership without revealing your private keys.`

      const signature = await signer.signMessage(message)

      // Generate alias from wallet address
      const alias = `xfuel-${walletAddress.slice(2, 8)}`

      // Store session in localStorage
      const sessionData = {
        address: walletAddress,
        alias,
        email: email || undefined,
        signedAt: new Date().toISOString(),
        signature,
      }

      try {
        localStorage.setItem('xfuel-session', JSON.stringify(sessionData))
        
        // If email provided, store separately for updates
        if (email) {
          localStorage.setItem('xfuel-email', email)
          
          // Optional: Send to webhook for email updates (production-ready)
          try {
            await fetch('/api/subscribe', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                email,
                walletAddress,
                timestamp: new Date().toISOString(),
              }),
            })
          } catch (webhookError) {
            // Silently fail webhook - email is still saved locally
            console.warn('Email webhook failed (non-critical):', webhookError)
          }
        }
      } catch (storageError) {
        console.error('Failed to save session:', storageError)
      }

      // Show success message
      setShowSuccess(true)

      // Call success callback
      setTimeout(() => {
        onSignInSuccess(alias, email || undefined)
        onClose()
        setShowSuccess(false)
        setEmail('')
      }, 2000)
    } catch (e: any) {
      console.error('Sign-in failed:', e)
      
      if (e?.code === 4001 || e?.message?.includes('rejected')) {
        setError('Signature rejected. Please try again.')
      } else {
        setError('Sign-in failed. Please try again.')
      }
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="relative w-full max-w-md rounded-3xl border-2 border-purple-400/60 bg-gradient-to-br from-[rgba(15,23,42,0.98)] via-[rgba(30,41,59,0.95)] to-[rgba(15,23,42,0.98)] backdrop-blur-2xl shadow-[0_0_80px_rgba(168,85,247,0.6),inset_0_0_60px_rgba(168,85,247,0.1)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-slate-600/50 bg-slate-800/50 text-slate-400 transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Content */}
          <div className="p-8 space-y-6">
            {showSuccess ? (
              // Success State
              <div className="text-center space-y-4 py-8">
                <div className="flex justify-center mb-4">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-400/60 bg-gradient-to-br from-emerald-500/40 to-emerald-600/30 shadow-[0_0_60px_rgba(16,185,129,0.8)]">
                    <span className="text-5xl">✓</span>
                  </div>
                </div>
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-400">
                  Signed in — personalized features unlocked
                </h2>
                <p className="text-sm text-slate-400">
                  Welcome to XFUEL! Your profile is ready.
                </p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="text-center space-y-2">
                  <div className="flex justify-center mb-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-purple-400/50 bg-gradient-to-br from-purple-500/30 to-cyan-500/20 shadow-[0_0_40px_rgba(168,85,247,0.6)]">
                      <span className="text-4xl">🔐</span>
                    </div>
                  </div>
                  <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400">
                    Official Log In
                  </h2>
                  <p className="text-sm text-slate-400">
                    Sign with your wallet to unlock personalized features
                  </p>
                </div>

                {!walletAddress ? (
                  // Wallet Not Connected State
                  <div className="space-y-4 py-4">
                    <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-center">
                      <p className="text-sm text-amber-300">
                        Connect your wallet first to sign in
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        onConnectWallet()
                        onClose()
                      }}
                      className="w-full group relative rounded-2xl border-2 border-purple-400/70 bg-gradient-to-br from-purple-500/25 via-purple-600/20 to-slate-900/40 px-6 py-4 text-center backdrop-blur-xl transition-all hover:border-purple-400 hover:shadow-[0_0_40px_rgba(168,85,247,0.8),inset_0_0_30px_rgba(168,85,247,0.3)] active:scale-[0.98]"
                    >
                      <p className="text-lg font-bold text-white group-hover:text-purple-200 transition-colors">
                        Connect Wallet
                      </p>
                    </button>
                  </div>
                ) : (
                  // Sign In Form
                  <div className="space-y-4">
                    {/* Connected Wallet Display */}
                    <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3">
                      <p className="text-[10px] uppercase tracking-wider text-emerald-300/80 mb-1">
                        Connected Wallet
                      </p>
                      <p className="text-sm font-mono text-emerald-300">
                        {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                      </p>
                    </div>

                    {/* Email Input (Optional) */}
                    <div className="space-y-2">
                      <label className="block text-xs uppercase tracking-wider text-slate-300/80">
                        Enter email for updates (optional)
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="your@email.com"
                        className="w-full rounded-xl border border-purple-400/30 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all"
                      />
                      <p className="text-[10px] text-slate-500">
                        We'll notify you about protocol updates, new features, and APY changes
                      </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                      <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-center">
                        <p className="text-sm text-red-300">{error}</p>
                      </div>
                    )}

                    {/* Sign In Button */}
                    <button
                      onClick={handleSignIn}
                      disabled={isSigningIn}
                      className="w-full group relative rounded-2xl border-2 border-purple-400/70 bg-gradient-to-br from-purple-500/25 via-purple-600/20 to-slate-900/40 px-6 py-4 text-center backdrop-blur-xl transition-all hover:border-purple-400 hover:shadow-[0_0_40px_rgba(168,85,247,0.8),inset_0_0_30px_rgba(168,85,247,0.3)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <p className="text-lg font-bold text-white group-hover:text-purple-200 transition-colors">
                        {isSigningIn ? 'Signing In...' : 'Sign with Wallet'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Free signature • No gas fees • Non-custodial
                      </p>
                    </button>

                    {/* Info */}
                    <div className="text-center pt-2">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                        🔒 Secure wallet signature • No private keys shared
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

