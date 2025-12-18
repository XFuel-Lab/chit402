import React from 'react'
import { Shield, CheckCircle, AlertCircle } from 'lucide-react'

type BadgeType = 'audited' | 'no-rug' | 'verified' | 'coming-soon'

interface SafetyBadgeProps {
  type: BadgeType
  className?: string
}

const badgeConfig: Record<BadgeType, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  audited: {
    label: 'Audited Soon',
    icon: <Shield className="h-4 w-4" />,
    color: 'text-blue-300',
    bgColor: 'bg-blue-500/20 border-blue-400/40',
  },
  'no-rug': {
    label: 'No Rug Risks',
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-green-300',
    bgColor: 'bg-green-500/20 border-green-400/40',
  },
  verified: {
    label: 'Verified Protocol',
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-purple-300',
    bgColor: 'bg-purple-500/20 border-purple-400/40',
  },
  'coming-soon': {
    label: 'Audit Coming Soon',
    icon: <AlertCircle className="h-4 w-4" />,
    color: 'text-amber-300',
    bgColor: 'bg-amber-500/20 border-amber-400/40',
  },
}

export function SafetyBadge({ type, className = '' }: SafetyBadgeProps) {
  const config = badgeConfig[type]

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition hover:scale-105 ${config.bgColor} ${config.color} ${className}`}
    >
      {config.icon}
      <span>{config.label}</span>
    </div>
  )
}

export function SafetyBadgeGroup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <SafetyBadge type="no-rug" />
      <SafetyBadge type="coming-soon" />
      <SafetyBadge type="verified" />
    </div>
  )
}

