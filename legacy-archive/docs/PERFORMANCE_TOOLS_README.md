# Performance Tools & Utilities

## Overview

This document describes the performance monitoring and testing tools available in the XFUEL Protocol application.

## Tools Included

### 1. Performance Monitor (`src/utils/performanceMonitor.ts`)

A comprehensive performance monitoring utility that tracks:
- Custom metrics
- INP (Interaction to Next Paint) events
- Long tasks
- Performance marks and measures

#### Usage:

```typescript
import { performanceMonitor, measureAsync } from './utils/performanceMonitor'

// Record a custom metric
performanceMonitor.recordMetric('api-call', 250, 'INP')

// Measure async operation
const result = await measureAsync('fetchData', async () => {
  return await fetch('/api/data').then(r => r.json())
})

// Get performance summary
const summary = performanceMonitor.getSummary()
console.table(summary)
```

#### Browser Console:

```javascript
// Access global instance
window.__performanceMonitor.getSummary()
window.__performanceMonitor.getINPEntries()
window.__performanceMonitor.getAllMetrics()
```

### 2. Web Vitals Tracker (`src/utils/webVitals.ts`)

Automatically tracks all Core Web Vitals:
- **INP** - Interaction to Next Paint
- **FCP** - First Contentful Paint
- **LCP** - Largest Contentful Paint
- **CLS** - Cumulative Layout Shift
- **FID** - First Input Delay
- **TTFB** - Time to First Byte

#### Features:
- Automatic initialization in development mode
- Console logging of all metrics
- Integration with Google Analytics (if configured)
- Custom callback support

#### Usage:

```typescript
import { initWebVitals, logWebVitals } from './utils/webVitals'

// Initialize with custom callback
initWebVitals((metric) => {
  // Send to your analytics service
  analytics.track('web-vital', {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
  })
})

// Log summary
logWebVitals()
```

### 3. Performance Testing Script (`scripts/test-performance.ts`)

Automated performance testing using Playwright.

#### What it tests:
- Page load metrics (FCP, LCP, TTFB)
- Interaction responsiveness (INP)
- Long tasks detection
- Common user interactions (clicks, typing)

#### Run tests:

```bash
# Install dependencies first
npm install

# Run performance tests
npm run test:performance
```

#### Output:
- Console report with all metrics
- JSON report saved to `performance-report.json`
- Exit code 1 if any interactions are slow (> 500ms)

#### Example output:

```
📊 Testing: http://localhost:5173

Core Web Vitals:
  FCP: 850ms
  LCP: 1200ms
  TTFB: 120ms

Interactions:
  ✅ Connect Wallet Button: 45ms
  ✅ Dropdown Toggle: 38ms
  ⚠️ Input Field: 220ms
  ✅ Swap Button: 95ms

⚠️ Long Tasks Detected: 2
  1. Duration: 65ms at 1500ms
  2. Duration: 52ms at 2300ms
```

## Installation

### Install Playwright (for testing):

```bash
npm install --save-dev playwright
```

The performance monitor and Web Vitals tracker are already included in the application.

## Configuration

### Environment Variables

None required - works out of the box.

### Customization

#### Change Performance Thresholds:

Edit `src/utils/performanceMonitor.ts`:

```typescript
export const THRESHOLDS = {
  INP: {
    good: 200,        // Change this
    needsImprovement: 500,
  },
  // ... other thresholds
}
```

#### Disable Web Vitals in Production:

Edit `src/utils/webVitals.ts`:

```typescript
// Comment out this section
// if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
//   if (document.readyState === 'complete') {
//     initWebVitals()
//   } else {
//     window.addEventListener('load', () => initWebVitals())
//   }
// }
```

## Integration with Analytics

### Google Analytics

The Web Vitals tracker automatically sends metrics to Google Analytics if `gtag` is available:

```html
<!-- Add to index.html -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

### Custom Analytics

```typescript
import { initWebVitals } from './utils/webVitals'

initWebVitals((metric) => {
  // Send to your analytics service
  fetch('/api/analytics', {
    method: 'POST',
    body: JSON.stringify({
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      page: window.location.pathname,
    }),
  })
})
```

## Debugging Performance Issues

### Step 1: Identify the Issue

```javascript
// In browser console
window.__performanceMonitor.getSummary()
```

Look for:
- High INP values (> 200ms)
- Many slow interactions
- Long tasks

### Step 2: Find the Culprit

```javascript
// Get all slow interactions
window.__performanceMonitor.getINPEntries()
  .filter(e => e.duration > 200)
  .forEach(e => console.log(e))
```

### Step 3: Profile with DevTools

1. Open Chrome DevTools → Performance
2. Click Record
3. Perform the slow interaction
4. Stop recording
5. Look for:
   - Red bars (long tasks)
   - Yellow bars (scripting)
   - Function call stacks

### Step 4: Fix the Issue

Common fixes:
- Add `useCallback` to event handlers
- Optimize `useMemo` dependencies
- Move expensive calculations outside render
- Debounce/throttle frequent operations

### Step 5: Verify the Fix

```bash
npm run test:performance
```

## CI/CD Integration

### GitHub Actions Example:

```yaml
name: Performance Tests

on: [pull_request]

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - run: npm run preview &
      - run: npx wait-on http://localhost:4173
      - run: npm run test:performance
```

## Best Practices

1. **Run tests regularly**: Include in CI/CD pipeline
2. **Set performance budgets**: Fail builds if metrics exceed thresholds
3. **Monitor in production**: Use Real User Monitoring (RUM)
4. **Test on real devices**: Emulators don't capture real performance
5. **Test slow networks**: Use Chrome DevTools network throttling

## Troubleshooting

### Issue: Performance tests fail to start

**Solution**: Make sure the dev server is running on the correct port.

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run test:performance
```

### Issue: Playwright not found

**Solution**: Install Playwright browsers:

```bash
npx playwright install
```

### Issue: Web Vitals not showing in console

**Solution**: Check that you're in development mode and the page has loaded completely.

```javascript
// Force initialization
import { initWebVitals } from './utils/webVitals'
initWebVitals()
```

## Resources

- [Web Vitals Documentation](https://web.dev/vitals/)
- [Playwright Documentation](https://playwright.dev/)
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)

## Support

For issues or questions:
1. Check the [Performance Optimization Guide](./PERFORMANCE_OPTIMIZATION.md)
2. Review the [Quick Start Guide](./PERFORMANCE_QUICK_START.md)
3. Open an issue on GitHub

