/**
 * usePerformance Hook
 * 
 * React hook for easy performance monitoring in components
 */

import { useEffect, useCallback, useRef } from 'react'
import { performanceMonitor, measureAsync } from '../utils/performanceMonitor'

export interface UsePerformanceOptions {
  componentName: string
  trackRenders?: boolean
  trackMounts?: boolean
}

/**
 * Hook to monitor component performance
 * 
 * @example
 * function MyComponent() {
 *   const { measureInteraction, trackRender } = usePerformance({
 *     componentName: 'MyComponent',
 *     trackRenders: true,
 *   })
 * 
 *   const handleClick = measureInteraction('button-click', () => {
 *     // Your click handler logic
 *   })
 * 
 *   return <button onClick={handleClick}>Click me</button>
 * }
 */
export function usePerformance(options: UsePerformanceOptions) {
  const { componentName, trackRenders = false, trackMounts = false } = options
  const renderCount = useRef(0)
  const mountTime = useRef<number>(0)

  // Track component mount
  useEffect(() => {
    if (trackMounts) {
      mountTime.current = performance.now()
      performanceMonitor.recordMetric(`${componentName}-mount`, mountTime.current)
    }

    return () => {
      if (trackMounts) {
        const unmountTime = performance.now()
        const lifetime = unmountTime - mountTime.current
        performanceMonitor.recordMetric(`${componentName}-lifetime`, lifetime)
      }
    }
  }, [componentName, trackMounts])

  // Track renders
  useEffect(() => {
    if (trackRenders) {
      renderCount.current++
      if (renderCount.current > 1) {
        performanceMonitor.recordMetric(`${componentName}-render`, renderCount.current)
      }
    }
  })

  /**
   * Measure an interaction (e.g., button click)
   */
  const measureInteraction = useCallback(
    <T extends (...args: any[]) => any>(
      interactionName: string,
      callback: T
    ): T => {
      return ((...args: any[]) => {
        const startTime = performance.now()
        const result = callback(...args)
        const duration = performance.now() - startTime

        performanceMonitor.recordMetric(
          `${componentName}-${interactionName}`,
          duration,
          'INP'
        )

        if (duration > 200) {
          console.warn(
            `⚠️ Slow interaction in ${componentName}.${interactionName}: ${duration.toFixed(2)}ms`
          )
        }

        return result
      }) as T
    },
    [componentName]
  )

  /**
   * Measure an async operation
   */
  const measureAsync = useCallback(
    async <T>(operationName: string, operation: () => Promise<T>): Promise<T> => {
      const startTime = performance.now()
      try {
        const result = await operation()
        const duration = performance.now() - startTime

        performanceMonitor.recordMetric(
          `${componentName}-${operationName}`,
          duration
        )

        return result
      } catch (error) {
        const duration = performance.now() - startTime
        console.error(
          `❌ ${componentName}.${operationName} failed after ${duration.toFixed(2)}ms`,
          error
        )
        throw error
      }
    },
    [componentName]
  )

  /**
   * Mark a performance point
   */
  const mark = useCallback(
    (markName: string) => {
      const fullName = `${componentName}-${markName}`
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(fullName)
      }
    },
    [componentName]
  )

  /**
   * Measure between two marks
   */
  const measure = useCallback(
    (measureName: string, startMark: string, endMark: string) => {
      const fullMeasureName = `${componentName}-${measureName}`
      const fullStartMark = `${componentName}-${startMark}`
      const fullEndMark = `${componentName}-${endMark}`

      if (typeof performance !== 'undefined' && performance.measure) {
        try {
          performance.measure(fullMeasureName, fullStartMark, fullEndMark)
          const measureEntry = performance.getEntriesByName(fullMeasureName, 'measure')[0]
          if (measureEntry) {
            performanceMonitor.recordMetric(fullMeasureName, measureEntry.duration)
            return measureEntry.duration
          }
        } catch (e) {
          console.warn('Failed to measure:', e)
        }
      }
      return 0
    },
    [componentName]
  )

  return {
    measureInteraction,
    measureAsync,
    mark,
    measure,
    renderCount: renderCount.current,
  }
}

/**
 * Hook to track render performance
 * 
 * @example
 * function MyComponent({ data }) {
 *   useRenderPerformance('MyComponent', [data])
 *   // Component will log slow renders
 * }
 */
export function useRenderPerformance(
  componentName: string,
  dependencies: any[] = []
) {
  const renderStartTime = useRef<number>(0)
  const renderCount = useRef(0)

  // Measure render start
  renderStartTime.current = performance.now()
  renderCount.current++

  useEffect(() => {
    const renderDuration = performance.now() - renderStartTime.current

    if (renderDuration > 16) {
      // More than one frame
      console.warn(
        `⏱️ Slow render in ${componentName}:`,
        `${renderDuration.toFixed(2)}ms`,
        `(${Math.ceil(renderDuration / 16)} frames)`
      )
    }

    performanceMonitor.recordMetric(`${componentName}-render`, renderDuration)
  })

  return renderCount.current
}

/**
 * Hook to measure effect performance
 * 
 * @example
 * function MyComponent() {
 *   const measureEffect = useEffectPerformance('MyComponent')
 * 
 *   useEffect(() => {
 *     measureEffect('data-fetch', async () => {
 *       await fetchData()
 *     })
 *   }, [])
 * }
 */
export function useEffectPerformance(componentName: string) {
  return useCallback(
    async (effectName: string, effect: () => void | Promise<void>) => {
      const startTime = performance.now()
      try {
        await effect()
        const duration = performance.now() - startTime
        performanceMonitor.recordMetric(
          `${componentName}-effect-${effectName}`,
          duration
        )
      } catch (error) {
        console.error(`Effect ${effectName} failed:`, error)
        throw error
      }
    },
    [componentName]
  )
}

