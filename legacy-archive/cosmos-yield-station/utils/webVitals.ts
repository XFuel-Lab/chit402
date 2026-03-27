/**
 * Web Vitals Integration
 * 
 * Tracks Core Web Vitals (CLS, FID, FCP, LCP, TTFB, INP) and reports them.
 * Uses the web-vitals library pattern for consistency.
 */

import { performanceMonitor, getRating, formatMetricValue, THRESHOLDS } from './performanceMonitor'

export interface WebVitalMetric {
  name: 'CLS' | 'FID' | 'FCP' | 'LCP' | 'TTFB' | 'INP'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  delta: number
  id: string
  navigationType: string
}

type ReportCallback = (metric: WebVitalMetric) => void

let reportCallback: ReportCallback | null = null

/**
 * Report a Web Vital metric
 */
function reportMetric(metric: WebVitalMetric) {
  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    const emoji = metric.rating === 'good' ? '✅' : metric.rating === 'needs-improvement' ? '⚠️' : '❌'
    console.log(`${emoji} ${metric.name}:`, {
      value: formatMetricValue(metric.name, metric.value),
      rating: metric.rating,
      id: metric.id,
    })
  }

  // Record in performance monitor
  performanceMonitor.recordMetric(metric.name, metric.value, metric.name)

  // Call custom callback if provided
  if (reportCallback) {
    reportCallback(metric)
  }

  // Send to analytics (if configured)
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', metric.name, {
      value: Math.round(metric.value),
      metric_rating: metric.rating,
      metric_id: metric.id,
    })
  }
}

/**
 * Get Cumulative Layout Shift (CLS)
 */
function getCLS(onReport: (metric: WebVitalMetric) => void) {
  let clsValue = 0
  let clsEntries: PerformanceEntry[] = []

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!(entry as any).hadRecentInput) {
        clsValue += (entry as any).value
        clsEntries.push(entry)
      }
    }
  })

  observer.observe({ type: 'layout-shift', buffered: true })

  // Report on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      observer.disconnect()
      onReport({
        name: 'CLS',
        value: clsValue,
        rating: getRating('CLS', clsValue),
        delta: clsValue,
        id: `v1-${Date.now()}`,
        navigationType: performance.navigation?.type.toString() || 'navigate',
      })
    }
  })
}

/**
 * Get First Input Delay (FID)
 */
function getFID(onReport: (metric: WebVitalMetric) => void) {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const fidEntry = entry as PerformanceEventTiming
      onReport({
        name: 'FID',
        value: fidEntry.processingStart - fidEntry.startTime,
        rating: getRating('FID', fidEntry.processingStart - fidEntry.startTime),
        delta: fidEntry.processingStart - fidEntry.startTime,
        id: `v1-${Date.now()}`,
        navigationType: performance.navigation?.type.toString() || 'navigate',
      })
      observer.disconnect()
    }
  })

  try {
    observer.observe({ type: 'first-input', buffered: true })
  } catch (e) {
    // first-input not supported
  }
}

/**
 * Get First Contentful Paint (FCP)
 */
function getFCP(onReport: (metric: WebVitalMetric) => void) {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') {
        onReport({
          name: 'FCP',
          value: entry.startTime,
          rating: getRating('FCP', entry.startTime),
          delta: entry.startTime,
          id: `v1-${Date.now()}`,
          navigationType: performance.navigation?.type.toString() || 'navigate',
        })
        observer.disconnect()
      }
    }
  })

  try {
    observer.observe({ type: 'paint', buffered: true })
  } catch (e) {
    // paint not supported
  }
}

/**
 * Get Largest Contentful Paint (LCP)
 */
function getLCP(onReport: (metric: WebVitalMetric) => void) {
  let lcpValue = 0

  const observer = new PerformanceObserver((list) => {
    const entries = list.getEntries()
    const lastEntry = entries[entries.length - 1]
    lcpValue = lastEntry.startTime
  })

  try {
    observer.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch (e) {
    // LCP not supported
  }

  // Report on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      observer.disconnect()
      if (lcpValue > 0) {
        onReport({
          name: 'LCP',
          value: lcpValue,
          rating: getRating('LCP', lcpValue),
          delta: lcpValue,
          id: `v1-${Date.now()}`,
          navigationType: performance.navigation?.type.toString() || 'navigate',
        })
      }
    }
  })
}

/**
 * Get Time to First Byte (TTFB)
 */
function getTTFB(onReport: (metric: WebVitalMetric) => void) {
  const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
  
  if (navigationEntry) {
    const ttfb = navigationEntry.responseStart - navigationEntry.requestStart
    onReport({
      name: 'TTFB',
      value: ttfb,
      rating: getRating('TTFB', ttfb),
      delta: ttfb,
      id: `v1-${Date.now()}`,
      navigationType: navigationEntry.type,
    })
  }
}

/**
 * Get Interaction to Next Paint (INP)
 * This is the most important metric for detecting UI responsiveness issues
 */
function getINP(onReport: (metric: WebVitalMetric) => void) {
  const interactions: number[] = []

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const eventEntry = entry as PerformanceEventTiming
      if (eventEntry.duration > 0) {
        interactions.push(eventEntry.duration)
      }
    }
  })

  try {
    observer.observe({ type: 'event', buffered: true, durationThreshold: 16 })
  } catch (e) {
    // event timing not supported
  }

  // Report on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && interactions.length > 0) {
      observer.disconnect()
      
      // INP is the 98th percentile of all interactions
      const sorted = interactions.sort((a, b) => a - b)
      const index = Math.floor(sorted.length * 0.98)
      const inpValue = sorted[index] || sorted[sorted.length - 1]

      onReport({
        name: 'INP',
        value: inpValue,
        rating: getRating('INP', inpValue),
        delta: inpValue,
        id: `v1-${Date.now()}`,
        navigationType: performance.navigation?.type.toString() || 'navigate',
      })
    }
  })
}

/**
 * Initialize Web Vitals tracking
 */
export function initWebVitals(callback?: ReportCallback) {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
    console.warn('Web Vitals not supported in this environment')
    return
  }

  reportCallback = callback || null

  // Track all Core Web Vitals
  getCLS(reportMetric)
  getFID(reportMetric)
  getFCP(reportMetric)
  getLCP(reportMetric)
  getTTFB(reportMetric)
  getINP(reportMetric)

  console.log('📊 Web Vitals tracking initialized')
}

/**
 * Get current Web Vitals summary
 */
export function getWebVitalsSummary() {
  const summary = performanceMonitor.getSummary()
  const vitals = ['CLS', 'FID', 'FCP', 'LCP', 'TTFB', 'INP']
  
  const result: Record<string, any> = {}
  
  vitals.forEach(vital => {
    if (summary[vital]) {
      result[vital] = {
        ...summary[vital],
        threshold: THRESHOLDS[vital as keyof typeof THRESHOLDS],
      }
    }
  })

  return result
}

/**
 * Log Web Vitals summary to console
 */
export function logWebVitals() {
  const summary = getWebVitalsSummary()
  console.table(summary)
}

// Auto-initialize in development
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  // Wait for page load
  if (document.readyState === 'complete') {
    initWebVitals()
  } else {
    window.addEventListener('load', () => initWebVitals())
  }
}

