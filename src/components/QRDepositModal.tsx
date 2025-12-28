import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'

interface QRDepositModalProps {
  isOpen: boolean
  onClose: () => void
  depositAddress: string
  amount: string // TFUEL amount (will be adjusted for 0.3% fee)
  network: string
  memo?: string
}

export default function QRDepositModal({
  isOpen,
  onClose,
  depositAddress,
  amount,
  network,
  memo = 'XPRT Pool Deposit',
}: QRDepositModalProps) {
  const [copied, setCopied] = useState(false)
  const [copiedURI, setCopiedURI] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  if (!isOpen) return null

  // Calculate amount with 0.3% fee included
  const numericAmount = parseFloat(amount) || 0
  const feeMultiplier = 1.003 // Add 0.3% fee
  const amountWithFee = (numericAmount * feeMultiplier).toFixed(6)

  // Create payment URI (Ethereum payment standard: ethereum:<address>@<chainId>?value=<wei>&memo=<text>)
  // For Theta Network (chainId 361)
  const weiAmount = (parseFloat(amountWithFee) * 1e18).toString()
  const paymentURI = `ethereum:${depositAddress}@361?value=${weiAmount}&memo=${encodeURIComponent(memo)}`

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(depositAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyURI = () => {
    navigator.clipboard.writeText(paymentURI)
    setCopiedURI(true)
    setTimeout(() => setCopiedURI(false), 2000)
  }

  const handleOpenWallet = () => {
    // Try to open Theta Wallet app on mobile
    window.location.href = paymentURI
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      {/* Modal Container */}
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <GlassCard className="relative border-2 border-purple-400/70 bg-gradient-to-br from-[rgba(168,85,247,0.25)] via-[rgba(56,189,248,0.20)] to-[rgba(15,23,42,0.40)] shadow-[0_0_60px_rgba(168,85,247,0.7),inset_0_0_30px_rgba(168,85,247,0.2)]">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-2 rounded-lg border border-slate-500/30 bg-slate-900/50 text-slate-400 hover:text-white hover:border-red-400/50 hover:bg-red-500/10 transition-all"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="space-y-6 p-6">
            {/* Header */}
            <div className="text-center">
              <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 mb-2">
                Deposit TFUEL
              </h2>
              <p className="text-sm text-slate-400">
                Send TFUEL + 0.3% fee via Theta Wallet app
              </p>
            </div>

            {/* QR Code Section - Desktop */}
            {!isMobile && (
              <div className="flex justify-center py-6">
                <div className="relative p-6 bg-white rounded-3xl shadow-[0_0_40px_rgba(168,85,247,0.8),inset_0_0_20px_rgba(255,255,255,0.9)]">
                  {/* Neon glow corners */}
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-cyan-400 rounded-tl-2xl" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-purple-400 rounded-tr-2xl" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-purple-400 rounded-bl-2xl" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-cyan-400 rounded-br-2xl" />
                  
                  <QRCodeSVG
                    value={paymentURI}
                    size={256}
                    level="H"
                    includeMargin={false}
                    fgColor="#0a0a14"
                    bgColor="#ffffff"
                  />
                </div>
              </div>
            )}

            {/* Amount Info */}
            <div className="space-y-3">
              <div className="p-4 rounded-2xl border-2 border-cyan-400/60 bg-gradient-to-br from-[rgba(56,189,248,0.30)] via-[rgba(168,85,247,0.20)] to-[rgba(15,23,42,0.35)] shadow-[0_0_40px_rgba(56,189,248,0.6),inset_0_0_20px_rgba(56,189,248,0.15)]">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-2">
                  Amount to Send
                </p>
                <div className="flex items-baseline gap-3">
                  <p className="text-4xl font-bold text-cyan-300 drop-shadow-[0_0_20px_rgba(56,189,248,1)]">
                    {amountWithFee}
                  </p>
                  <p className="text-xl font-bold text-white">TFUEL</p>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Includes 0.3% fee ({numericAmount.toFixed(6)} TFUEL + {(numericAmount * 0.003).toFixed(6)} TFUEL fee)
                </p>
              </div>

              {/* Deposit Address */}
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400/80 mb-2">
                  {network} Deposit Address
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-900/50 border border-purple-400/20 rounded-lg px-4 py-3">
                    <p className="text-sm font-mono text-cyan-300 break-all">
                      {depositAddress}
                    </p>
                  </div>
                  <button
                    onClick={handleCopyAddress}
                    className="px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-lg border-2 border-purple-400/60 bg-gradient-to-br from-purple-500/20 via-purple-600/15 to-slate-900/40 text-purple-200 transition-all hover:border-purple-400 hover:shadow-[0_0_25px_rgba(168,85,247,0.7),inset_0_0_15px_rgba(168,85,247,0.2)]"
                  >
                    {copied ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Memo/Reference */}
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-400/30">
                <p className="text-xs uppercase tracking-[0.18em] text-purple-300 mb-1">
                  Transaction Memo
                </p>
                <p className="text-sm text-slate-300 font-mono">
                  {memo}
                </p>
              </div>
            </div>

            {/* Mobile Actions */}
            {isMobile && (
              <div className="space-y-3">
                <NeonButton
                  label="Open Theta Wallet"
                  rightHint="deep link"
                  onClick={handleOpenWallet}
                  className="w-full"
                />
                <button
                  onClick={handleCopyURI}
                  className="w-full px-6 py-3 text-sm font-bold uppercase tracking-wider rounded-xl border-2 border-cyan-400/60 bg-gradient-to-br from-cyan-500/20 via-cyan-600/15 to-slate-900/40 text-cyan-200 transition-all hover:border-cyan-400 hover:shadow-[0_0_25px_rgba(6,182,212,0.7),inset_0_0_15px_rgba(6,182,212,0.2)]"
                >
                  {copiedURI ? '✓ Payment URI Copied!' : 'Copy Payment URI'}
                </button>
              </div>
            )}

            {/* Instructions */}
            <div className="bg-amber-500/10 border border-amber-400/30 rounded-2xl p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300 mb-3 flex items-center gap-2">
                <span className="text-xl">📱</span>
                How to deposit
              </p>
              <ol className="text-sm text-slate-300 space-y-2">
                {isMobile ? (
                  <>
                    <li className="flex gap-2">
                      <span className="text-cyan-400 font-bold">1.</span>
                      <span>Tap "Open Theta Wallet" or copy the payment URI</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-cyan-400 font-bold">2.</span>
                      <span>Confirm the transaction in your wallet</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-cyan-400 font-bold">3.</span>
                      <span>Your LST tokens will be minted automatically</span>
                    </li>
                  </>
                ) : (
                  <>
                    <li className="flex gap-2">
                      <span className="text-cyan-400 font-bold">1.</span>
                      <span>Open your Theta Wallet app on mobile</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-cyan-400 font-bold">2.</span>
                      <span>Scan this QR code with the wallet scanner</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-cyan-400 font-bold">3.</span>
                      <span>Verify the amount and memo, then confirm</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-cyan-400 font-bold">4.</span>
                      <span>Your LST tokens will be minted automatically</span>
                    </li>
                  </>
                )}
              </ol>
            </div>

            {/* Success Note */}
            <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-2xl p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300 mb-2 flex items-center gap-2">
                <span className="text-lg">✨</span>
                After deposit
              </p>
              <p className="text-sm text-slate-300">
                <span className="text-emerald-400 font-bold">TFUEL received</span> — stkXPRT minting soon
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Your staked tokens will appear in your wallet within 1-2 minutes
              </p>
            </div>

            {/* Network Badge */}
            <div className="flex items-center justify-center gap-2 pt-2">
              <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-400/30 rounded-full px-4 py-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-semibold text-purple-300">
                  {network} Network
                </span>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

