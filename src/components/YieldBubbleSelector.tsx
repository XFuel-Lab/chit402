import React from 'react'

export type LSTOption = {
  name: string
  apy: number
}

type Props = {
  options: LSTOption[]
  selected: LSTOption
  onSelect: (option: LSTOption) => void
}

/**
 * Horizontal bubble selector for yield options (highest APY → lowest).
 */
export function YieldBubbleSelector({ options, selected, onSelect }: Props) {
  const sorted = [...options].sort((a, b) => b.apy - a.apy)

  return (
    <div className="mt-8 flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-slate-300/80">
        <span className="uppercase tracking-[0.18em] text-slate-400/90">
          Yield lanes
        </span>
        <span className="text-[11px] text-purple-200/80">
          Highest APY &rarr; lowest
        </span>
      </div>

      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1 pt-1">
        {sorted.map((opt) => {
          const isActive = opt.name === selected.name
          return (
            <button
              key={opt.name}
              type="button"
              onClick={() => onSelect(opt)}
              className={[
                'group relative flex min-w-[150px] flex-col items-start gap-1 rounded-full border px-4 py-2.5 text-left',
                'transition-all duration-300 ease-out',
                isActive
                  ? 'border-purple-400/90 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.45),transparent_55%),rgba(15,23,42,0.9)] shadow-[0_0_32px_rgba(168,85,247,0.9)]'
                  : 'border-white/10 bg-[rgba(15,23,42,0.75)] hover:border-purple-400/70 hover:bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.35),transparent_55%),rgba(15,23,42,0.9)] hover:shadow-[0_0_22px_rgba(168,85,247,0.8)]',
                'backdrop-blur-2xl xfuel-tap-glow',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300/85">
                {opt.name}
              </span>
              <span className="flex items-baseline gap-1 text-sm font-semibold text-emerald-300 drop-shadow-[0_0_12px_rgba(16,185,129,0.9)]">
                {opt.apy.toFixed(1)}%
                <span className="text-[11px] font-normal uppercase tracking-[0.14em] text-slate-300/80">
                  APY
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default YieldBubbleSelector


