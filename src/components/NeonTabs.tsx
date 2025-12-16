import React from 'react'

type TabId = 'swap' | 'staking' | 'tip-pools' | 'mining' | 'profile'

export type Tab = {
  id: TabId
  label: string
  pill?: string
}

type Props = {
  tabs: Tab[]
  activeId: TabId
  onChange: (id: TabId) => void
}

/**
 * EdgeFarm-style neon tab bar.
 * Works best placed just above the main glass card.
 */
export function NeonTabs({ tabs, activeId, onChange }: Props) {
  return (
    <div className="mb-4 flex w-full justify-center sm:mb-5">
      <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-1 py-1 backdrop-blur-xl shadow-[0_0_30px_rgba(15,23,42,0.9)]">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={[
                'relative flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-250 ease-out',
                isActive
                  ? 'bg-gradient-to-r from-purple-500 via-cyan-400 to-pink-500 text-white shadow-[0_0_22px_rgba(168,85,247,0.8)]'
                  : 'text-slate-300/80 hover:text-white hover:bg-white/5',
                'xfuel-tap-glow',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="uppercase tracking-[0.18em]">{tab.label}</span>
              {tab.pill && (
                <span
                  className={[
                    'rounded-full px-2 py-[1px] text-[10px] uppercase tracking-[0.12em]',
                    isActive
                      ? 'bg-black/40 text-purple-200'
                      : 'bg-purple-500/10 text-purple-200/80',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {tab.pill}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type NeonTabId = TabId

export default NeonTabs

