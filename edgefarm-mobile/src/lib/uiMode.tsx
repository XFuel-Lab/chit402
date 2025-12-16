import React, { createContext, useContext, useMemo, useState } from 'react'

type UiModeContextValue = {
  screenshotMode: boolean
  setScreenshotMode: (value: boolean) => void
  rareVariant: boolean
}

const UiModeContext = createContext<UiModeContextValue | undefined>(undefined)

export function UiModeProvider({ children }: { children: React.ReactNode }) {
  const [screenshotMode, setScreenshotMode] = useState(false)

  const value = useMemo<UiModeContextValue>(() => {
    // Roll a rare variant once per app session
    const rareVariant = Math.random() < 0.01
    return {
      screenshotMode,
      setScreenshotMode,
      rareVariant,
    }
  }, [screenshotMode])

  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>
}

export function useUiMode() {
  const ctx = useContext(UiModeContext)
  if (!ctx) {
    throw new Error('useUiMode must be used within UiModeProvider')
  }
  return ctx
}


