import React from 'react'

interface SkeletonProps {
  className?: string
  width?: string
  height?: string
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full'
}

export function Skeleton({ className = '', width, height, rounded = 'md' }: SkeletonProps) {
  const roundedClass = {
    none: '',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded]

  return (
    <div
      className={`bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite] ${roundedClass} ${className}`}
      style={{
        width: width || '100%',
        height: height || '1rem',
      }}
    />
  )
}

export function CardSkeleton() {
  return (
    <div className="rounded-3xl border border-purple-400/20 bg-gradient-to-br from-[rgba(168,85,247,0.15)] via-[rgba(56,189,248,0.10)] to-[rgba(15,23,42,0.25)] backdrop-blur-xl p-6">
      <Skeleton height="1.5rem" width="60%" className="mb-4" />
      <Skeleton height="3rem" width="100%" className="mb-3" />
      <Skeleton height="1rem" width="80%" className="mb-2" />
      <Skeleton height="1rem" width="90%" />
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton height="2.5rem" width="2.5rem" rounded="full" />
          <Skeleton height="1rem" width="30%" />
          <Skeleton height="1rem" width="20%" />
          <Skeleton height="1rem" width="25%" />
        </div>
      ))}
    </div>
  )
}

export function BalanceSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton height="1.25rem" width="40%" />
      <Skeleton height="2.5rem" width="60%" />
    </div>
  )
}

