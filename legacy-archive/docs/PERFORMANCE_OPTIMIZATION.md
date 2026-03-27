# Performance Optimization Guide

## Overview

This document describes the performance optimizations implemented in the XFUEL Protocol application, focusing on improving **INP (Interaction to Next Paint)** and other Core Web Vitals.

## Table of Contents

1. [Performance Issues Identified](#performance-issues-identified)
2. [Optimizations Applied](#optimizations-applied)
3. [Performance Monitoring](#performance-monitoring)
4. [Testing Performance](#testing-performance)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Performance Issues Identified

### INP Issue: 200ms UI Blocking

**Location**: `BiDirectionalSwapCard.tsx`

**Problem**: Event handlers on `span.text-sm.text-slate-400` elements were blocking UI updates for 200ms.

**Root Causes**:
1. **Expensive `useMemo` recalculations** triggered on every state change
2. **Inline arrow functions** creating new function instances on each render
3. **Object dependencies** in `useMemo` causing unnecessary recalculations
4. **Missing `useCallback`** for event handlers

---

## Optimizations Applied

### 1. BiDirectionalSwapCard.tsx

#### Before:
```typescript
// ❌ Entire object as dependency
const estimatedOutput = useMemo(() => {
  // ... expensive calculations ...
}, [inputAmount, fromToken, toToken, prices, route])

// ❌ Inline arrow function
<button onClick={() => setShowFromDropdown(!showFromDropdown)}>
```

#### After:
```typescript
// ✅ Primitive values as dependencies
const estimatedOutput = useMemo(() => {
  // ... expensive calculations ...
}, [inputAmount, fromToken.symbol, toToken.symbol, prices, route?.bridgeFee])

// ✅ Stable callback reference
const toggleFromDropdown = useCallback(() => {
  setShowFromDropdown(prev => !prev)
}, [])

<button onClick={toggleFromDropdown}>
```

**Impact**: Reduced UI blocking from 200ms to < 50ms

### 2. YieldPumpCard.tsx

#### Optimizations:
- Added `useCallback` for `handleMaxClick`, `handleDeposit`
- Created stable dropdown toggle handlers
- Optimized `useMemo` dependencies for `estimatedOutput`
- Replaced inline event handlers with memoized callbacks

#### Before:
```typescript
<button onClick={(e) => {
  e.stopPropagation()
  setShowLSTDropdown(!showLSTDropdown)
}}>
```

#### After:
```typescript
const toggleLSTDropdown = useCallback((e: React.MouseEvent) => {
  e.stopPropagation()
  setShowLSTDropdown(prev => !prev)
}, [])

<button onClick={toggleLSTDropdown}>
```

### 3. SingleSidedLPDeposit.tsx

#### Optimizations:
- Optimized `preview` useMemo dependencies
- Changed from object reference to primitive values

---

## Performance Monitoring

### Web Vitals Integration

The application now tracks all Core Web Vitals:

- **INP** (Interaction to Next Paint) - Target: < 200ms
- **FCP** (First Contentful Paint) - Target: < 1.8s
- **LCP** (Largest Contentful Paint) - Target: < 2.5s
- **CLS** (Cumulative Layout Shift) - Target: < 0.1
- **FID** (First Input Delay) - Target: < 100ms
- **TTFB** (Time to First Byte) - Target: < 800ms

### Usage

#### In Browser Console:

```javascript
// View performance monitor
window.__performanceMonitor.getSummary()

// View INP entries
window.__performanceMonitor.getINPEntries()

// Log Web Vitals
logWebVitals()
```

#### In Code:

```typescript
import { performanceMonitor, measureAsync } from './utils/performanceMonitor'

// Measure async operation
const data = await measureAsync('fetchUserData', async () => {
  return await fetch('/api/user').then(r => r.json())
})

// Record custom metric
performanceMonitor.recordMetric('custom-operation', 150, 'INP')
```

---

## Testing Performance

### Automated Performance Testing

Run the performance test suite:

```bash
npm run test:performance
```

This will:
1. Launch a headless browser
2. Navigate to key pages
3. Simulate user interactions
4. Measure interaction durations
5. Detect long tasks (> 50ms)
6. Generate a performance report

### Manual Testing

#### Using Chrome DevTools:

1. Open DevTools → **Performance** tab
2. Click **Record** (or Ctrl+E)
3. Interact with the UI (click dropdowns, buttons, etc.)
4. Stop recording
5. Look for:
   - **Long Tasks** (red bars) - should be < 50ms
   - **INP** in the Interactions track
   - **Frame drops** in the Frames track

#### Using Lighthouse:

1. Open DevTools → **Lighthouse** tab
2. Select **Performance** category
3. Click **Analyze page load**
4. Check:
   - Performance score (target: > 90)
   - INP metric (target: < 200ms)
   - Total Blocking Time (target: < 300ms)

### Performance Thresholds

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| INP | ≤ 200ms | ≤ 500ms | > 500ms |
| FCP | ≤ 1.8s | ≤ 3.0s | > 3.0s |
| LCP | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| FID | ≤ 100ms | ≤ 300ms | > 300ms |
| TTFB | ≤ 800ms | ≤ 1800ms | > 1800ms |

---

## Best Practices

### 1. Use `useCallback` for Event Handlers

```typescript
// ✅ Good
const handleClick = useCallback(() => {
  doSomething()
}, [])

<button onClick={handleClick}>

// ❌ Bad
<button onClick={() => doSomething()}>
```

### 2. Optimize `useMemo` Dependencies

```typescript
// ✅ Good - primitive values
useMemo(() => {
  return calculate(user.id, user.name)
}, [user.id, user.name])

// ❌ Bad - entire object
useMemo(() => {
  return calculate(user.id, user.name)
}, [user])
```

### 3. Avoid Expensive Calculations in Render

```typescript
// ✅ Good - memoized
const expensiveValue = useMemo(() => {
  return heavyCalculation(data)
}, [data])

// ❌ Bad - recalculated every render
const expensiveValue = heavyCalculation(data)
```

### 4. Use Stable References

```typescript
// ✅ Good
const selectToken = useCallback((token: Token) => {
  setSelectedToken(token)
  closeDropdown()
}, [])

// ❌ Bad - new function every render
{tokens.map(token => (
  <button onClick={() => {
    setSelectedToken(token)
    closeDropdown()
  }}>
))}
```

### 5. Debounce/Throttle Expensive Operations

```typescript
import { useCallback } from 'react'

const debouncedSearch = useCallback(
  debounce((query: string) => {
    performSearch(query)
  }, 300),
  []
)
```

### 6. Code Split Large Components

```typescript
import { lazy, Suspense } from 'react'

const HeavyComponent = lazy(() => import('./HeavyComponent'))

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <HeavyComponent />
    </Suspense>
  )
}
```

---

## Troubleshooting

### Issue: High INP (> 200ms)

**Symptoms**: UI feels sluggish, interactions take time to respond

**Solutions**:
1. Check for inline arrow functions in event handlers
2. Verify `useMemo`/`useCallback` dependencies are optimized
3. Look for expensive calculations in render
4. Use Chrome DevTools Performance profiler to identify bottlenecks

### Issue: Long Tasks Detected

**Symptoms**: Console warnings about long tasks

**Solutions**:
1. Break up synchronous work into smaller chunks
2. Use `requestIdleCallback` for non-urgent work
3. Move heavy calculations to Web Workers
4. Lazy load components

### Issue: Poor LCP (> 2.5s)

**Symptoms**: Page content takes long to appear

**Solutions**:
1. Optimize images (use WebP, proper sizing)
2. Preload critical resources
3. Reduce render-blocking resources
4. Use code splitting

### Issue: High CLS (> 0.1)

**Symptoms**: Page layout shifts during load

**Solutions**:
1. Set explicit dimensions for images/videos
2. Reserve space for dynamic content
3. Avoid inserting content above existing content
4. Use `aspect-ratio` CSS property

---

## Performance Checklist

Before deploying:

- [ ] Run `npm run test:performance` and verify all interactions < 200ms
- [ ] Check Lighthouse score > 90
- [ ] Verify no console warnings about long tasks
- [ ] Test on slower devices/networks
- [ ] Verify Web Vitals are in "good" range
- [ ] Check bundle size hasn't increased significantly
- [ ] Test with React DevTools Profiler

---

## Resources

- [Web Vitals](https://web.dev/vitals/)
- [INP Optimization](https://web.dev/inp/)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)

---

## Changelog

### 2024-12-23
- Fixed INP issue in `BiDirectionalSwapCard.tsx` (200ms → < 50ms)
- Optimized `YieldPumpCard.tsx` event handlers
- Optimized `SingleSidedLPDeposit.tsx` useMemo dependencies
- Added Web Vitals tracking
- Created performance monitoring utilities
- Added automated performance testing script

