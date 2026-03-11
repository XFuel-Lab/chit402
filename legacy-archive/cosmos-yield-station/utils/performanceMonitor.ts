/**
 * Performance Monitoring Utilities
 * 
 * This module provides tools to monitor and track Web Vitals and custom performance metrics.
 * It helps identify performance bottlenecks and INP (Interaction to Next Paint) issues.
 */

export interface PerformanceMetric {
  name: string
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  timestamp: number
}

export interface INPEntry {
  interactionType: string
  duration: number
  target: string
  timestamp: number
}

// Thresholds based on Web Vitals standards
export const THRESHOLDS = {
  INP: {
    good: 200,
    needsImprovement: 500,
  },
  FCP: {
    good: 1800,
    needsImprovement: 3000,
  },
  LCP: {
    good: 2500,
    needsImprovement: 4000,
  },
  CLS: {
    good: 0.1,
    needsImprovement: 0.25,
  },
  FID: {
    good: 100,
    needsImprovement: 300,
  },
  TTFB: {
    good: 800,
    needsImprovement: 1800,
  },
}

/**
 * Get rating for a metric value
 */
export function getRating(
  metricName: keyof typeof THRESHOLDS,
  value: number
): 'good' | 'needs-improvement' | 'poor' {
  const threshold = THRESHOLDS[metricName]
  if (value <= threshold.good) return 'good'
  if (value <= threshold.needsImprovement) return 'needs-improvement'
  return 'poor'
}

/**
 * Format metric value for display
 */
export function formatMetricValue(metricName: string, value: number): string {
  if (metricName === 'CLS') {
    return value.toFixed(3)
  }
  return `${Math.round(value)}ms`
}

/**
 * Performance Monitor Class
 * Tracks and logs performance metrics
 */
export class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map()
  private inpEntries: INPEntry[] = []
  private isMonitoring = false
  private observer: PerformanceObserver | null = null

  constructor() {
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      this.setupObservers()
    }
  }

  /**
   * Setup Performance Observers
   */
  private setupObservers() {
    try {
      // Observe long tasks (potential INP issues)
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') {
            console.warn('⚠️ Long Task Detected:', {
              duration: entry.duration,
              startTime: entry.startTime,
              name: entry.name,
            })
          }

          // Track event timing (for INP)
          if (entry.entryType === 'event' && 'duration' in entry) {
            const eventEntry = entry as PerformanceEventTiming
            if (eventEntry.duration > 50) {
              this.trackINP({
                interactionType: eventEntry.name,
                duration: eventEntry.duration,
                target: (eventEntry.target as Element)?.tagName || 'unknown',
                timestamp: Date.now(),
              })
            }
          }
        }
      })

      // Observe multiple entry types
      try {
        this.observer.observe({ 
          entryTypes: ['longtask', 'event', 'measure'] 
        })
        this.isMonitoring = true
      } catch (e) {
        // Fallback if some entry types aren't supported
        console.warn('Some performance entry types not supported:', e)
      }
    } catch (error) {
      console.warn('Performance Observer not fully supported:', error)
    }
  }

  /**
   * Track an INP event
   */
  private trackINP(entry: INPEntry) {
    this.inpEntries.push(entry)
    
    // Keep only last 100 entries
    if (this.inpEntries.length > 100) {
      this.inpEntries.shift()
    }

    // Log if duration exceeds threshold
    if (entry.duration > THRESHOLDS.INP.good) {
      console.warn('🐌 Slow Interaction Detected:', {
        type: entry.interactionType,
        duration: `${Math.round(entry.duration)}ms`,
        target: entry.target,
        rating: getRating('INP', entry.duration),
      })
    }
  }

  /**
   * Record a custom metric
   */
  recordMetric(name: string, value: number, metricType?: keyof typeof THRESHOLDS) {
    const rating = metricType ? getRating(metricType, value) : 'good'
    
    const metric: PerformanceMetric = {
      name,
      value,
      rating,
      timestamp: Date.now(),
    }

    if (!this.metrics.has(name)) {
      this.metrics.set(name, [])
    }
    
    this.metrics.get(name)!.push(metric)

    // Log poor metrics
    if (rating === 'poor') {
      console.warn(`📊 Poor Performance: ${name}`, {
        value: formatMetricValue(metricType || name, value),
        rating,
      })
    }
  }

  /**
   * Get all INP entries
   */
  getINPEntries(): INPEntry[] {
    return [...this.inpEntries]
  }

  /**
   * Get metrics by name
   */
  getMetrics(name: string): PerformanceMetric[] {
    return this.metrics.get(name) || []
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, PerformanceMetric[]> {
    return new Map(this.metrics)
  }

  /**
   * Get performance summary
   */
  getSummary() {
    const summary: Record<string, any> = {
      isMonitoring: this.isMonitoring,
      totalMetrics: this.metrics.size,
      inpEvents: this.inpEntries.length,
      slowInteractions: this.inpEntries.filter(e => e.duration > THRESHOLDS.INP.good).length,
    }

    // Add average for each metric
    this.metrics.forEach((values, name) => {
      const avg = values.reduce((sum, m) => sum + m.value, 0) / values.length
      summary[name] = {
        count: values.length,
        average: Math.round(avg),
        latest: values[values.length - 1]?.value,
      }
    })

    return summary
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear()
    this.inpEntries = []
  }

  /**
   * Stop monitoring
   */
  disconnect() {
    if (this.observer) {
      this.observer.disconnect()
      this.isMonitoring = false
    }
  }
}

/**
 * Measure component render time
 */
export function measureRender(componentName: string, callback: () => void) {
  const startTime = performance.now()
  callback()
  const duration = performance.now() - startTime

  if (duration > 16) { // More than one frame (60fps)
    console.warn(`⏱️ Slow Render: ${componentName}`, {
      duration: `${duration.toFixed(2)}ms`,
      frames: Math.ceil(duration / 16),
    })
  }

  return duration
}

/**
 * Measure async operation
 */
export async function measureAsync<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = performance.now()
  try {
    const result = await operation()
    const duration = performance.now() - startTime
    
    console.log(`⏱️ ${operationName}: ${duration.toFixed(2)}ms`)
    return result
  } catch (error) {
    const duration = performance.now() - startTime
    console.error(`❌ ${operationName} failed after ${duration.toFixed(2)}ms`, error)
    throw error
  }
}

/**
 * Create a performance mark
 */
export function mark(name: string) {
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(name)
  }
}

/**
 * Measure between two marks
 */
export function measure(name: string, startMark: string, endMark: string) {
  if (typeof performance !== 'undefined' && performance.measure) {
    try {
      performance.measure(name, startMark, endMark)
      const measure = performance.getEntriesByName(name, 'measure')[0]
      return measure?.duration || 0
    } catch (e) {
      console.warn('Failed to measure:', e)
      return 0
    }
  }
  return 0
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor()

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).__performanceMonitor = performanceMonitor
}

