import React, { useRef, useState, useEffect } from 'react'

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
 * 2026's best swap page - smooth horizontal scroll, no vertical scroll, fade indicators.
 */
export function YieldBubbleSelector({ options, selected, onSelect }: Props) {
  const sorted = [...options].sort((a, b) => b.apy - a.apy)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showLeftFade, setShowLeftFade] = useState(false)
  const [showRightFade, setShowRightFade] = useState(true)

  // Update fade indicators based on scroll position
  const updateFadeIndicators = () => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollLeft, scrollWidth, clientWidth } = container
    setShowLeftFade(scrollLeft > 10)
    setShowRightFade(scrollLeft < scrollWidth - clientWidth - 10)
  }

  // Handle horizontal scroll with mouse wheel - smooth and natural
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current
    if (!container) return
    
    // Always prevent default to block vertical scroll
    e.preventDefault()
    e.stopPropagation()
    
    // Convert vertical wheel movement to horizontal scroll
    // Use deltaY (vertical) for regular mouse wheel, deltaX for trackpad horizontal swipe
    const scrollAmount = e.deltaY !== 0 ? e.deltaY : e.deltaX
    
    // Smooth scroll with momentum
    container.scrollBy({
      left: scrollAmount,
      behavior: 'auto' // Instant for responsive feel
    })
    
    updateFadeIndicators()
  }

  // Update fade indicators on scroll
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    updateFadeIndicators()

    const handleScroll = () => {
      updateFadeIndicators()
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

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

      <div className="relative">
        {/* Left fade indicator */}
        {showLeftFade && (
          <div 
            className="pointer-events-none absolute left-0 top-0 z-10 h-full w-16 bg-gradient-to-r from-[rgba(15,23,42,0.95)] to-transparent"
            style={{
              boxShadow: 'inset 20px 0 20px -10px rgba(15,23,42,0.8)'
            }}
          />
        )}
        
        {/* Right fade indicator */}
        {showRightFade && (
          <div 
            className="pointer-events-none absolute right-0 top-0 z-10 h-full w-16 bg-gradient-to-l from-[rgba(15,23,42,0.95)] to-transparent"
            style={{
              boxShadow: 'inset -20px 0 20px -10px rgba(15,23,42,0.8)'
            }}
          />
        )}

        <div 
          ref={scrollContainerRef}
          onWheel={handleWheel}
          className="no-scrollbar flex gap-4 overflow-x-auto overflow-y-hidden scroll-smooth pb-2 pt-2 px-1"
          style={{
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // IE/Edge
            WebkitOverflowScrolling: 'touch', // iOS momentum scrolling
            overscrollBehavior: 'contain', // Prevent scroll chaining
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
                  'group relative flex min-w-[180px] flex-shrink-0 flex-col items-start gap-1.5 rounded-full border px-6 py-3.5 text-left',
                  'transition-all duration-300 ease-out backdrop-blur-xl',
                  'hover:scale-110 active:scale-105',
                  isActive
                    ? 'border-purple-400/90 bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.5),rgba(129,140,248,0.4)_40%,transparent_70%),rgba(15,23,42,0.95)] shadow-[0_0_45px_rgba(168,85,247,1),0_0_80px_rgba(168,85,247,0.6),inset_0_0_30px_rgba(168,85,247,0.2)]'
                    : 'border-purple-400/30 bg-[rgba(15,23,42,0.7)] hover:border-purple-400/70 hover:bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.35),rgba(129,140,248,0.25)_40%,transparent_70%),rgba(15,23,42,0.9)] hover:shadow-[0_0_35px_rgba(168,85,247,0.9),0_0_60px_rgba(168,85,247,0.5)]',
                  'cursor-pointer',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate-200/90 font-semibold">
                  {opt.name}
                </span>
                <span className="flex items-baseline gap-1.5 text-lg font-bold text-emerald-300 drop-shadow-[0_0_20px_rgba(16,185,129,1),0_0_35px_rgba(16,185,129,0.6)]">
                  {opt.apy.toFixed(1)}%
                  <span className="text-[11px] font-normal uppercase tracking-[0.14em] text-slate-300/80">
                    APY
                  </span>
                </span>
                {isActive && (
                  <div className="absolute -inset-1 rounded-full bg-purple-400/10 blur-xl -z-10" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default YieldBubbleSelector


