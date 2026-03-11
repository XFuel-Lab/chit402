# Performance Optimization - Quick Start Guide

## 🚀 Quick Commands

```bash
# Run performance tests
npm run test:performance

# Monitor performance in dev mode
npm run dev
# Then check browser console for Web Vitals

# View performance data in console
window.__performanceMonitor.getSummary()
```

## 📊 Key Metrics to Watch

| Metric | Target | Critical |
|--------|--------|----------|
| **INP** | < 200ms | < 500ms |
| **LCP** | < 2.5s | < 4.0s |
| **CLS** | < 0.1 | < 0.25 |

## ✅ Quick Fixes for Common Issues

### Slow Button Clicks (INP > 200ms)

```typescript
// ❌ Before
<button onClick={() => setState(!state)}>

// ✅ After
const toggle = useCallback(() => setState(prev => !prev), [])
<button onClick={toggle}>
```

### Expensive Calculations

```typescript
// ❌ Before
const result = expensiveCalc(data)

// ✅ After
const result = useMemo(() => expensiveCalc(data), [data.id])
```

### Dropdown Performance

```typescript
// ❌ Before
{items.map(item => (
  <button onClick={() => select(item)}>
))}

// ✅ After
const handleSelect = useCallback((item) => select(item), [])
{items.map(item => (
  <button onClick={() => handleSelect(item)}>
))}
```

## 🔍 Debug Performance Issues

### Chrome DevTools
1. Open DevTools → Performance
2. Record interaction
3. Look for red bars (long tasks)
4. Check INP in Interactions track

### Console Commands
```javascript
// View all metrics
window.__performanceMonitor.getSummary()

// View slow interactions
window.__performanceMonitor.getINPEntries()
  .filter(e => e.duration > 200)

// Log Web Vitals
logWebVitals()
```

## 📝 Component Optimization Checklist

When creating/updating components:

- [ ] Use `useCallback` for all event handlers
- [ ] Use `useMemo` for expensive calculations
- [ ] Use primitive values in dependency arrays
- [ ] Avoid inline arrow functions in JSX
- [ ] Test interaction speed < 200ms

## 🎯 Performance Targets

### Development
- All interactions < 200ms
- No console warnings about long tasks
- Lighthouse score > 85

### Production
- All interactions < 150ms
- Lighthouse score > 90
- All Web Vitals in "good" range

## 📚 More Info

See [PERFORMANCE_OPTIMIZATION.md](./PERFORMANCE_OPTIMIZATION.md) for detailed guide.

