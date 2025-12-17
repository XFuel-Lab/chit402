import React, { useEffect, useState } from 'react'
import confetti from 'canvas-confetti'

type NFT = {
  id: string
  name: string
  rarity: 'Mythic' | 'Legendary' | 'Epic' | 'Rare'
}

type LotteryWinExplosionProps = {
  visible: boolean
  winAmount: number
  nft?: NFT
  onClose: () => void
  apy?: number
}

export function LotteryWinExplosion({
  visible,
  winAmount,
  nft,
  onClose,
  apy = 38,
}: LotteryWinExplosionProps) {
  const [showContent, setShowContent] = useState(false)

  useEffect(() => {
    if (!visible) {
      setShowContent(false)
      return
    }

    // Trigger epic confetti explosion
    const duration = 5000
    const animationEnd = Date.now() + duration
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 }

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min
    }

    const interval: NodeJS.Timeout = setInterval(function () {
      const timeLeft = animationEnd - Date.now()

      if (timeLeft <= 0) {
        return clearInterval(interval)
      }

      const particleCount = 50 * (timeLeft / duration)
      
      // Multiple confetti sources for epic explosion
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors: ['#a855f7', '#06b6d4', '#ec4899', '#10b981', '#fbbf24'],
      })
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors: ['#ec4899', '#a855f7', '#06b6d4', '#10b981'],
      })
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.4, 0.6), y: Math.random() - 0.2 },
        colors: ['#06b6d4', '#10b981', '#a855f7', '#ec4899'],
      })
    }, 250)

    // Show content after brief delay
    setTimeout(() => setShowContent(true), 300)

    return () => clearInterval(interval)
  }, [visible])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-[92%] max-w-lg rounded-3xl border-2 border-pink-400/60 bg-[rgba(15,23,42,0.96)] p-8 shadow-[0_0_60px_rgba(236,72,153,0.8),0_0_120px_rgba(236,72,153,0.4)] transition-all duration-300 ${
          showContent ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          {/* Main win message */}
          <h1
            className="mb-4 text-4xl font-black tracking-tight text-pink-400"
            style={{
              textShadow: '0 0 20px rgba(236,72,153,0.9), 0 0 40px rgba(236,72,153,0.6)',
            }}
          >
            🎉 YOU WON! 🎉
          </h1>

          <h2 className="mb-6 text-2xl font-bold text-white">
            ${winAmount.toLocaleString()} Lottery Prize!
          </h2>

          {/* NFT Showcase if won */}
          {nft && (
            <div className="mb-6 overflow-hidden rounded-2xl border-2 border-purple-400/80 bg-gradient-to-br from-purple-500/85 via-cyan-500/75 to-pink-500/65 p-6 shadow-[0_0_40px_rgba(168,85,247,0.8)]">
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-white/90">
                NFT RAFFLE PRIZE
              </p>
              <div className="mb-4 flex items-center justify-center">
                <div className="flex h-32 w-32 items-center justify-center rounded-2xl border-2 border-white/40 bg-[rgba(15,23,42,0.9)]">
                  <span className="text-6xl">🏆</span>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-bold text-white">{nft.name}</h3>
              <div className="inline-block rounded-full border border-amber-400/80 bg-[rgba(24,24,48,0.9)] px-4 py-1">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-300">
                  {nft.rarity}
                </p>
              </div>
            </div>
          )}

          {/* Auto-stake message */}
          <div className="mb-6 rounded-2xl border border-emerald-400/60 bg-emerald-500/10 p-4">
            <p className="mb-2 text-sm text-white/95">
              💰 Prize auto-staked to stTFUEL vault (mock)
            </p>
            <p className="text-lg font-bold text-emerald-300">Now earning {apy}% APY</p>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="rounded-full border border-pink-400/80 bg-pink-500/20 px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-pink-500/30 hover:shadow-[0_0_20px_rgba(236,72,153,0.6)]"
          >
            Claim & Continue
          </button>
        </div>
      </div>
    </div>
  )
}

export default LotteryWinExplosion

