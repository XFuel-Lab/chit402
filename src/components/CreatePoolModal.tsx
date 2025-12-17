import React, { useState } from 'react'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'

type CreatePoolModalProps = {
  visible: boolean
  onClose: () => void
  onCreate: (duration: number) => Promise<void>
  loading?: boolean
}

export function CreatePoolModal({ visible, onClose, onCreate, loading = false }: CreatePoolModalProps) {
  const [duration, setDuration] = useState(86400) // Default 24 hours

  if (!visible) return null

  const handleCreate = async () => {
    await onCreate(duration)
    onClose()
  }

  const durationOptions = [
    { label: '6 hours', value: 21600 },
    { label: '12 hours', value: 43200 },
    { label: '24 hours', value: 86400 },
    { label: '48 hours', value: 172800 },
    { label: '7 days', value: 604800 },
  ]

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="w-[92%] max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <GlassCard>
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-xl font-bold text-white">Create New Pool</h2>
              <p className="text-sm text-slate-300/80">
                Set up a new tip pool. Fans can tip into it, and when it ends, a winner is drawn via VRF lottery.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-300/70">
                Pool Duration
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {durationOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDuration(option.value)}
                    className={`rounded-xl border px-3 py-2 text-sm transition-all ${
                      duration === option.value
                        ? 'border-purple-400/80 bg-purple-500/20 text-white shadow-[0_0_20px_rgba(168,85,247,0.5)]'
                        : 'border-purple-400/30 bg-black/20 text-slate-300 hover:border-purple-400/50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <NeonButton
                label="Cancel"
                variant="secondary"
                onClick={onClose}
                className="flex-1"
              />
              <NeonButton
                label={loading ? 'Creating...' : 'Create Pool'}
                onClick={handleCreate}
                disabled={loading}
                className="flex-1"
              />
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

export default CreatePoolModal

