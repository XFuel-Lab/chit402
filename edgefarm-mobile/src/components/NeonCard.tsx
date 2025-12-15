import React from 'react'
import { GlassCard } from './GlassCard'

export function NeonCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <GlassCard className={className}>{children}</GlassCard>
}
