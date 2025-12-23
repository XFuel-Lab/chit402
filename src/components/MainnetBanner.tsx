import { useState, useEffect } from 'react'

const BANNER_STORAGE_KEY = 'xfuel-mainnet-banner-dismissed'

export default function MainnetBanner() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Check if banner was previously dismissed
    const dismissed = localStorage.getItem(BANNER_STORAGE_KEY)
    if (!dismissed) {
      setIsVisible(true)
    }
  }, [])

  const handleDismiss = () => {
    setIsVisible(false)
    localStorage.setItem(BANNER_STORAGE_KEY, 'true')
  }

  if (!isVisible) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 animate-fadeIn">
      <div className="relative overflow-hidden">
        {/* Purple gradient background with glow */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-900/95 via-fuchsia-800/95 to-purple-900/95" />
        
        {/* Neon glow effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 via-fuchsia-400/20 to-purple-500/20 blur-xl" />
        
        {/* Content */}
        <div className="relative flex items-center justify-center px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 justify-center">
            <span className="text-lg sm:text-xl" role="img" aria-label="rocket">
              🚀
            </span>
            <p className="text-sm sm:text-base font-medium text-white text-center leading-snug">
              <span className="font-bold text-fuchsia-200 drop-shadow-[0_0_8px_rgba(232,121,249,0.8)]">
                Live on Mainnet
              </span>
              {' — '}
              <span className="text-purple-100">
                Try the Pumping Station with small amounts first! Real TFUEL & yields. Audit coming soon.
              </span>
            </p>
          </div>
          
          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="ml-3 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:ring-offset-2 focus:ring-offset-purple-900 group"
            aria-label="Dismiss banner"
          >
            <svg
              className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white group-hover:text-fuchsia-200 transition-colors"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Bottom neon border */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-fuchsia-400 to-transparent shadow-[0_0_8px_rgba(232,121,249,0.6)]" />
      </div>
    </div>
  )
}

