import React, { useEffect, useState } from 'react'
import { X, RefreshCw } from 'lucide-react'

interface ErrorToastProps {
  message: string
  onRetry?: () => void
  onDismiss?: () => void
  autoDismiss?: boolean
  dismissAfter?: number
}

export function ErrorToast({
  message,
  onRetry,
  onDismiss,
  autoDismiss = true,
  dismissAfter = 5000,
}: ErrorToastProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (autoDismiss && visible) {
      const timer = setTimeout(() => {
        setVisible(false)
        onDismiss?.()
      }, dismissAfter)
      return () => clearTimeout(timer)
    }
  }, [autoDismiss, visible, dismissAfter, onDismiss])

  if (!visible) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-[slideIn_0.3s_ease-out]">
      <div className="rounded-2xl border border-red-400/60 bg-gradient-to-br from-red-900/40 via-red-800/30 to-gray-900/50 backdrop-blur-xl p-4 shadow-[0_0_40px_rgba(239,68,68,0.5)] min-w-[320px] max-w-md">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">
            <div className="h-5 w-5 rounded-full bg-red-500/20 flex items-center justify-center">
              <X className="h-3 w-3 text-red-400" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-100">{message}</p>
            {onRetry && (
              <button
                onClick={() => {
                  onRetry()
                  setVisible(false)
                  onDismiss?.()
                }}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-400/40 bg-red-900/30 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-900/50 hover:border-red-400/60"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            )}
          </div>
          {onDismiss && (
            <button
              onClick={() => {
                setVisible(false)
                onDismiss()
              }}
              className="flex-shrink-0 rounded-lg p-1 text-red-300/60 transition hover:bg-red-900/30 hover:text-red-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ErrorToastContainerProps {
  errors: Array<{ id: string; message: string; onRetry?: () => void }>
  onDismiss: (id: string) => void
}

export function ErrorToastContainer({ errors, onDismiss }: ErrorToastContainerProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-3">
      {errors.map((error) => (
        <ErrorToast
          key={error.id}
          message={error.message}
          onRetry={error.onRetry}
          onDismiss={() => onDismiss(error.id)}
        />
      ))}
    </div>
  )
}

