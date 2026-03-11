import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'

interface ManualDepositCardProps {
  depositAddress: string
  network: string
  onCopyAddress?: () => void
}

export default function ManualDepositCard({
  depositAddress,
  network,
  onCopyAddress,
}: ManualDepositCardProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('')
  const [copied, setCopied] = useState(false)

  // Generate QR code on mount
  useEffect(() => {
    QRCode.toDataURL(depositAddress, {
      width: 256,
      margin: 2,
      color: {
        dark: '#ffffff',
        light: '#0a0a14',
      },
    })
      .then((url) => setQrCodeDataUrl(url))
      .catch((err) => console.error('QR code generation failed:', err))
  }, [depositAddress])

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(depositAddress)
    setCopied(true)
    onCopyAddress?.()
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <GlassCard className="p-6">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h3 className="text-xl font-bold text-white mb-1">
            Manual TFUEL Deposit
          </h3>
          <p className="text-sm text-slate-400">
            No wallet connect needed — send TFUEL directly to this address
          </p>
        </div>

        {/* QR Code */}
        <div className="flex justify-center py-4">
          <div className="p-4 bg-white rounded-2xl">
            {qrCodeDataUrl ? (
              <img
                src={qrCodeDataUrl}
                alt="Deposit address QR code"
                className="w-64 h-64"
              />
            ) : (
              <div className="w-64 h-64 flex items-center justify-center bg-slate-800 rounded-lg">
                <span className="text-slate-500">Generating QR...</span>
              </div>
            )}
          </div>
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
            <NeonButton
              label={copied ? 'Copied!' : 'Copy'}
              onClick={handleCopyAddress}
              rightHint={copied ? '✓' : undefined}
            />
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300 mb-2">
            📱 How to deposit
          </p>
          <ol className="text-sm text-slate-300 space-y-1">
            <li>1. Open your Theta Wallet app</li>
            <li>2. Scan this QR code or copy the address</li>
            <li>3. Send TFUEL to complete your swap</li>
            <li>4. Your LST tokens will be minted automatically</li>
          </ol>
        </div>

        {/* Network Badge */}
        <div className="flex items-center justify-center gap-2">
          <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-400/30 rounded-full px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-purple-300">
              {network} Network
            </span>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

