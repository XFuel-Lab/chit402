import React, { useRef } from 'react'

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
 * Supports mouse wheel, touch, and keyboard scrolling.
 */
export function YieldBubbleSelector({ options, selected, onSelect }: Props) {
  const sorted = [...options].sort((a, b) => b.apy - a.apy)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Handle horizontal scroll with mouse wheel
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!scrollContainerRef.current) return
    
    // Prevent vertical page scroll when scrolling horizontally
    if (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0) {
      e.preventDefault()
      
      // Scroll horizontally (use deltaY for vertical wheel, deltaX for horizontal trackpad)
      const scrollAmount = e.deltaX || e.deltaY
      scrollContainerRef.current.scrollLeft += scrollAmount
    }
  }

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

      <div 
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="no-scrollbar flex gap-3 overflow-x-auto scroll-smooth pb-1 pt-1 snap-x snap-mandatory"
        style={{
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none', // IE/Edge
          WebkitOverflowScrolling: 'touch', // iOS momentum scrolling
        }}
      >
        {sorted.map((opt) => {
          const isActive = opt.name === selected.name
          return (
            <button
              key={opt.name}
              type="button"
              onClick={() => onSelect(opt)}
              className={[
                'group relative flex min-w-[160px] flex-shrink-0 flex-col items-start gap-1 rounded-full border px-5 py-3 text-left snap-center',
                'transition-all duration-300 ease-out backdrop-blur-xl',
                isActive
                  ? 'border-purple-400/90 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.45),transparent_55%),rgba(15,23,42,0.9)] shadow-[0_0_40px_rgba(168,85,247,0.9)] hover:scale-105'
                  : 'border-purple-400/40 bg-[rgba(15,23,42,0.75)] hover:border-purple-400/70 hover:bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.35),transparent_55%),rgba(15,23,42,0.9)] hover:shadow-[0_0_28px_rgba(168,85,247,0.8)] hover:scale-105',
                'xfuel-tap-glow',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300/90">
                {opt.name}
              </span>
              <span className="flex items-baseline gap-1 text-base font-bold text-emerald-300 drop-shadow-[0_0_16px_rgba(16,185,129,0.9)]">
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


