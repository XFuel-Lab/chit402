import { useState } from 'react'
import { X } from 'lucide-react'

interface BetaBannerProps {
  network: 'mainnet' | 'testnet'
}

export default function BetaBanner({ network }: BetaBannerProps) {
  const [isVisible, setIsVisible] = useState(true)

  // Only show on mainnet
  if (network !== 'mainnet' || !isVisible) {
    return null
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-red-600 via-red-500 to-orange-600 shadow-lg">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="flex items-center justify-center w-8 h-8 bg-white/20 rounded-full backdrop-blur-sm">
              <span className="text-white text-xl font-bold">⚠️</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-bold text-sm sm:text-base uppercase tracking-wide">
                  🚨 Live Mainnet Testing
                </span>
                <span className="hidden sm:inline text-white/90">•</span>
                <span className="text-white/90 text-xs sm:text-sm font-medium">
                  Swap at Your Own Risk
                </span>
              </div>
              <div className="text-white/80 text-xs mt-1">
                Max: 1,000 TFUEL per swap • 5,000 TFUEL total per user • Unaudited Beta
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsVisible(false)}
            className="flex items-center justify-center w-8 h-8 bg-white/10 hover:bg-white/20 rounded-full transition-colors backdrop-blur-sm group"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  )
}

