/**
 * Performance Testing Script
 * 
 * This script helps test and validate performance optimizations.
 * Run with: npm run test:performance
 */

import { chromium, Browser, Page } from 'playwright'
import { writeFileSync } from 'fs'
import { join } from 'path'

interface PerformanceResult {
  url: string
  timestamp: string
  metrics: {
    FCP: number | null
    LCP: number | null
    CLS: number | null
    TTFB: number | null
    TBT: number | null
    INP: number | null
  }
  interactions: Array<{
    type: string
    selector: string
    duration: number
    rating: 'good' | 'needs-improvement' | 'poor'
  }>
  longTasks: Array<{
    duration: number
    startTime: number
  }>
}

const INP_THRESHOLDS = {
  good: 200,
  needsImprovement: 500,
}

function getRating(duration: number): 'good' | 'needs-improvement' | 'poor' {
  if (duration <= INP_THRESHOLDS.good) return 'good'
  if (duration <= INP_THRESHOLDS.needsImprovement) return 'needs-improvement'
  return 'poor'
}

async function measurePagePerformance(page: Page, url: string): Promise<PerformanceResult> {
  console.log(`\n📊 Testing: ${url}`)
  
  // Navigate to page
  await page.goto(url, { waitUntil: 'networkidle' })

  // Wait for page to be fully loaded
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)

  // Collect Web Vitals
  const metrics = await page.evaluate(() => {
    return new Promise<any>((resolve) => {
      const result: any = {
        FCP: null,
        LCP: null,
        CLS: null,
        TTFB: null,
        TBT: null,
        INP: null,
      }

      // Get navigation timing for TTFB
      const navTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      if (navTiming) {
        result.TTFB = navTiming.responseStart - navTiming.requestStart
      }

      // Get paint timing for FCP
      const paintEntries = performance.getEntriesByType('paint')
      const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint')
      if (fcpEntry) {
        result.FCP = fcpEntry.startTime
      }

      // Get LCP
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const lastEntry = entries[entries.length - 1]
        result.LCP = lastEntry.startTime
      })
      
      try {
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
      } catch (e) {
        console.warn('LCP not supported')
      }

      // Get CLS
      let clsValue = 0
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            clsValue += (entry as any).value
          }
        }
        result.CLS = clsValue
      })

      try {
        clsObserver.observe({ type: 'layout-shift', buffered: true })
      } catch (e) {
        console.warn('CLS not supported')
      }

      // Wait a bit for metrics to be collected
      setTimeout(() => {
        lcpObserver.disconnect()
        clsObserver.disconnect()
        resolve(result)
      }, 1000)
    })
  })

  // Test interactions and measure INP
  const interactions: PerformanceResult['interactions'] = []
  const longTasks: PerformanceResult['longTasks'] = []

  // Start long task observation
  await page.evaluate(() => {
    (window as any).__longTasks = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        (window as any).__longTasks.push({
          duration: entry.duration,
          startTime: entry.startTime,
        })
      }
    })
    try {
      observer.observe({ type: 'longtask', buffered: true })
    } catch (e) {
      console.warn('Long task observer not supported')
    }
  })

  // Test common interactions
  const interactionTests = [
    { selector: 'button:has-text("Connect")', type: 'click', name: 'Connect Wallet Button' },
    { selector: '[class*="dropdown"]', type: 'click', name: 'Dropdown Toggle' },
    { selector: 'input[type="text"]', type: 'type', name: 'Input Field', text: '100' },
    { selector: 'button:has-text("Swap")', type: 'click', name: 'Swap Button' },
  ]

  for (const test of interactionTests) {
    try {
      const element = await page.$(test.selector)
      if (element) {
        const startTime = Date.now()
        
        if (test.type === 'click') {
          await element.click()
        } else if (test.type === 'type' && test.text) {
          await element.type(test.text)
        }

        // Wait for UI to update
        await page.waitForTimeout(100)

        const duration = Date.now() - startTime

        interactions.push({
          type: test.name,
          selector: test.selector,
          duration,
          rating: getRating(duration),
        })

        console.log(`  ${test.name}: ${duration}ms [${getRating(duration)}]`)
      }
    } catch (e) {
      console.log(`  ${test.name}: Element not found or interaction failed`)
    }
  }

  // Collect long tasks
  const collectedLongTasks = await page.evaluate(() => (window as any).__longTasks || [])
  longTasks.push(...collectedLongTasks)

  return {
    url,
    timestamp: new Date().toISOString(),
    metrics,
    interactions,
    longTasks,
  }
}

async function runPerformanceTests() {
  console.log('🚀 Starting Performance Tests\n')

  const browser: Browser = await chromium.launch({
    headless: true,
  })

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  })

  const page = await context.newPage()

  // Enable performance monitoring
  await page.addInitScript(() => {
    (window as any).__performanceData = []
  })

  const results: PerformanceResult[] = []

  // Test URLs (adjust based on your setup)
  const testUrls = [
    'http://localhost:5173',
    'http://localhost:5173/#swap',
    'http://localhost:5173/#staking',
  ]

  for (const url of testUrls) {
    try {
      const result = await measurePagePerformance(page, url)
      results.push(result)
    } catch (error) {
      console.error(`❌ Error testing ${url}:`, error)
    }
  }

  await browser.close()

  // Generate report
  console.log('\n📋 Performance Test Results\n')
  console.log('=' .repeat(80))

  results.forEach((result) => {
    console.log(`\n${result.url}`)
    console.log('-'.repeat(80))
    
    console.log('\nCore Web Vitals:')
    Object.entries(result.metrics).forEach(([key, value]) => {
      if (value !== null) {
        console.log(`  ${key}: ${Math.round(value)}ms`)
      }
    })

    console.log('\nInteractions:')
    result.interactions.forEach((interaction) => {
      const emoji = interaction.rating === 'good' ? '✅' : interaction.rating === 'needs-improvement' ? '⚠️' : '❌'
      console.log(`  ${emoji} ${interaction.type}: ${interaction.duration}ms`)
    })

    if (result.longTasks.length > 0) {
      console.log(`\n⚠️ Long Tasks Detected: ${result.longTasks.length}`)
      result.longTasks.forEach((task, i) => {
        console.log(`  ${i + 1}. Duration: ${Math.round(task.duration)}ms at ${Math.round(task.startTime)}ms`)
      })
    }
  })

  // Save results to file
  const reportPath = join(process.cwd(), 'performance-report.json')
  writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n💾 Full report saved to: ${reportPath}`)

  // Check for failures
  const hasSlowInteractions = results.some(r => 
    r.interactions.some(i => i.rating === 'poor')
  )

  if (hasSlowInteractions) {
    console.log('\n❌ Performance test FAILED: Slow interactions detected')
    process.exit(1)
  } else {
    console.log('\n✅ Performance test PASSED')
    process.exit(0)
  }
}

// Run tests
runPerformanceTests().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

