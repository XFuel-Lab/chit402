/**
 * Priority-based Layout Configuration
 * Defines display elements with priority, size, and position
 */

export type ElementPriority = 'high' | 'medium' | 'low'
export type ElementSize = 'large' | 'medium' | 'small'
export type ElementPosition = 'top' | 'center' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface LayoutElement {
  id: string
  priority: ElementPriority
  size: ElementSize
  position: ElementPosition
  visible: boolean
  className?: string
}

export const DEFAULT_LAYOUT_CONFIG: LayoutElement[] = [
  // High priority - top/center (prime real estate)
  {
    id: 'input-amount',
    priority: 'high',
    size: 'large',
    position: 'center',
    visible: true,
  },
  {
    id: 'selected-token',
    priority: 'high',
    size: 'large',
    position: 'center',
    visible: true,
  },
  {
    id: 'output-amount',
    priority: 'high',
    size: 'large',
    position: 'center',
    visible: true,
  },
  {
    id: 'best-yield-lst',
    priority: 'high',
    size: 'large',
    position: 'center',
    visible: true,
    className: 'highlight-best-yield',
  },
  {
    id: 'rate',
    priority: 'medium',
    size: 'medium',
    position: 'center',
    visible: true,
  },
  {
    id: 'apy',
    priority: 'medium',
    size: 'medium',
    position: 'center',
    visible: true,
  },
  {
    id: 'slippage',
    priority: 'medium',
    size: 'small',
    position: 'center',
    visible: true,
  },
  // Low priority - minimized/moved to corners
  {
    id: 'wallet-display',
    priority: 'low',
    size: 'small',
    position: 'bottom-right',
    visible: true,
    className: 'wallet-minimized',
  },
  {
    id: 'exchange-rate',
    priority: 'low',
    size: 'small',
    position: 'bottom',
    visible: true,
  },
  {
    id: 'transaction-history',
    priority: 'low',
    size: 'small',
    position: 'bottom',
    visible: true,
  },
]

/**
 * Get layout config for a specific element
 */
export function getLayoutConfig(elementId: string): LayoutElement | undefined {
  return DEFAULT_LAYOUT_CONFIG.find((el) => el.id === elementId)
}

/**
 * Get all elements sorted by priority
 */
export function getElementsByPriority(priority: ElementPriority): LayoutElement[] {
  return DEFAULT_LAYOUT_CONFIG.filter((el) => el.priority === priority && el.visible)
}

/**
 * Get size classes for an element
 */
export function getSizeClasses(size: ElementSize): string {
  const classes = {
    large: 'text-3xl font-bold',
    medium: 'text-lg font-semibold',
    small: 'text-sm',
  }
  return classes[size] || classes.medium
}

