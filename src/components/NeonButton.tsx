import React, { type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

type Props = {
  label: string
  iconLeft?: ReactNode
  rightHint?: string
  variant?: Variant
} & ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Neon gradient button with soft pulse + glow on hover/press.
 * Web analogue of the mobile NeonButton.
 */
export function NeonButton({
  label,
  iconLeft,
  rightHint,
  variant = 'primary',
  className = '',
  ...rest
}: Props) {
  const palette: Record<Variant, string> = {
    primary:
      'from-[rgba(168,85,247,0.98)] via-[rgba(56,189,248,0.96)] to-[rgba(236,72,153,0.9)]',
    secondary: 'from-[rgba(15,23,42,0.95)] via-[rgba(15,23,42,0.8)] to-[rgba(15,23,42,0.95)]',
    danger: 'from-[rgba(248,113,113,0.96)] via-[rgba(168,85,247,0.9)] to-[rgba(56,189,248,0.85)]',
  }

  const glow: Record<Variant, string> = {
    primary: 'shadow-[0_0_32px_rgba(168,85,247,0.8)]',
    secondary: 'shadow-[0_0_22px_rgba(148,163,184,0.45)]',
    danger: 'shadow-[0_0_32px_rgba(248,113,113,0.8)]',
  }

  return (
    <button
      className={[
        'relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 px-5 py-3.5',
        'bg-gradient-to-r',
        palette[variant],
        glow[variant],
        'transition-transform duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_0_42px_rgba(168,85,247,1)] active:translate-y-0 active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none',
        'before:pointer-events-none before:absolute before:-inset-10 before:-translate-x-full before:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.45),transparent_55%)] before:opacity-70 before:transition-transform before:duration-[900ms] before:ease-out hover:before:translate-x-0',
        'xfuel-tap-glow',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <span className="relative z-10 flex w-full items-center justify-center gap-2 text-sm font-semibold tracking-wide text-white">
        {iconLeft ? <span className="flex items-center">{iconLeft}</span> : null}
        <span>{label}</span>
        {rightHint ? (
          <span className="text-[11px] uppercase tracking-[0.16em] text-white/80">{rightHint}</span>
        ) : null}
      </span>
    </button>
  )
}

export default NeonButton


