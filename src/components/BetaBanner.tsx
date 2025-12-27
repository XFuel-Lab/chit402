import { X, AlertTriangle } from 'lucide-react'

interface BetaBannerProps {
  network: 'mainnet' | 'testnet'
}

export default function BetaBanner({ network }: BetaBannerProps) {
  // Beta banner is ALWAYS visible on mainnet (non-dismissible for safety)
  // Only hide on testnet
  if (network !== 'mainnet') {
    return null
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-red-600 via-red-500 to-orange-600 shadow-[0_4px_20px_rgba(220,38,38,0.6)]">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="flex items-center justify-center w-10 h-10 bg-white/20 rounded-full backdrop-blur-sm animate-pulse">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-bold text-sm sm:text-base uppercase tracking-wide">
                  🚨 Live Mainnet Beta Testing
                </span>
                <span className="hidden sm:inline text-white/90">•</span>
                <span className="text-white/90 text-xs sm:text-sm font-medium">
                  Unaudited Contracts - Swap at Your Own Risk
                </span>
              </div>
              <div className="text-white/90 text-xs sm:text-sm mt-1 font-medium">
                <span className="font-bold">Safety Limits:</span> Max 1,000 TFUEL/swap • 5,000 TFUEL total/user • Emergency pause active
              </div>
            </div>
          </div>
          {/* Info icon instead of close (non-dismissible for safety) */}
          <div
            className="flex items-center justify-center w-8 h-8 bg-white/10 rounded-full backdrop-blur-sm cursor-help"
            title="Beta testing limits enforced for safety. Contracts are unaudited."
          >
            <span className="text-white text-lg">ⓘ</span>
          </div>
        </div>
      </div>
    </div>
  )
}

