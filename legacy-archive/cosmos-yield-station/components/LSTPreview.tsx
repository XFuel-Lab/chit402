import React from 'react'
import { LSTTokenConfig } from '../utils/lstTokens'

interface LSTPreviewProps {
  inputAmount: number
  inputToken: string
  outputAmount: number
  outputLST: LSTTokenConfig
  tfuelPrice: number | null
  lstPrice: number | null
}

/**
 * Preview Section: Receive amount + Estimated yearly yield + vs holding comparison
 */
export function LSTPreview({
  inputAmount,
  inputToken,
  outputAmount,
  outputLST,
  tfuelPrice,
  lstPrice,
}: LSTPreviewProps) {
  if (inputAmount <= 0 || outputAmount <= 0) return null

  // Calculate estimated yearly yield
  const annualYieldUSD = (outputAmount * outputLST.apy) / 100 * (lstPrice || 0)
  const dailyYieldUSD = annualYieldUSD / 365

  // Calculate "vs holding" comparison
  // If holding TFUEL, assume 0% APY (or could use TFUEL staking APY if available)
  const holdingValueAfter1Year = inputAmount * (tfuelPrice || 0)
  const stakingValueAfter1Year = outputAmount * (lstPrice || 0) * (1 + outputLST.apy / 100)
  const additionalYield = stakingValueAfter1Year - holdingValueAfter1Year

  return (
    <div className="rounded-3xl border border-cyan-400/60 bg-gradient-to-br from-[rgba(56,189,248,0.25)] via-[rgba(168,85,247,0.20)] to-[rgba(15,23,42,0.30)] p-6 backdrop-blur-xl shadow-[0_0_40px_rgba(56,189,248,0.4)]">
      <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
        You'll receive
      </p>

      {/* Receive Amount */}
      <div className="mb-6 flex items-baseline gap-3">
        <span className="text-4xl font-bold text-cyan-300 drop-shadow-[0_0_20px_rgba(56,189,248,0.9)]">
          ~{outputAmount.toFixed(4)}
        </span>
        <span className="text-xl font-semibold text-white">{outputLST.symbol}</span>
      </div>

      {/* Instant Rate Display */}
      {tfuelPrice && lstPrice && (
        <div className="mb-6 rounded-2xl border border-purple-400/40 bg-black/30 px-4 py-3 backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
            Instant Rate
          </p>
          <p className="mt-1 text-lg font-bold text-purple-300">
            1 {inputToken} = {(tfuelPrice / lstPrice).toFixed(4)} {outputLST.symbol}
          </p>
        </div>
      )}

      {/* Estimated Yearly Yield */}
      <div className="mb-4 rounded-2xl border border-emerald-400/60 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 px-4 py-4 backdrop-blur-sm shadow-[0_0_20px_rgba(16,185,129,0.3)]">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
              Estimated Annual Yield
            </p>
            <p className="mt-2 text-2xl font-bold text-emerald-300 drop-shadow-[0_0_16px_rgba(16,185,129,0.9)]">
              ${annualYieldUSD.toFixed(2)} USD
            </p>
            <p className="mt-1 text-sm text-emerald-200/90">
              {outputLST.apy.toFixed(1)}% APY
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
              Daily
            </p>
            <p className="mt-2 text-lg font-semibold text-emerald-300">
              ${dailyYieldUSD.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* VS Holding Comparison */}
      <div className="rounded-2xl border border-purple-400/40 bg-gradient-to-br from-purple-500/10 to-cyan-500/10 px-4 py-4 backdrop-blur-sm">
        <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
          vs Holding {inputToken}
        </p>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">Holding {inputToken} (0% APY)</span>
            <span className="text-sm font-semibold text-slate-400">
              ${holdingValueAfter1Year.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-emerald-300">
              Staking {outputLST.symbol} ({outputLST.apy.toFixed(1)}% APY)
            </span>
            <span className="text-sm font-bold text-emerald-300">
              ${stakingValueAfter1Year.toFixed(2)}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-purple-400/30 pt-3">
            <span className="text-sm font-semibold text-white">Additional Yield (1 Year)</span>
            <span className="text-lg font-bold text-emerald-300 drop-shadow-[0_0_12px_rgba(16,185,129,0.8)]">
              +${additionalYield.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LSTPreview

