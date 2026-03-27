# Performance Hook Examples

## usePerformance Hook

The `usePerformance` hook provides an easy way to monitor component performance.

## Basic Usage

```typescript
import { usePerformance } from '../hooks/usePerformance'

function MyComponent() {
  const { measureInteraction } = usePerformance({
    componentName: 'MyComponent',
  })

  const handleClick = measureInteraction('button-click', () => {
    console.log('Button clicked!')
  })

  return <button onClick={handleClick}>Click me</button>
}
```

## Track Renders

```typescript
function MyComponent({ data }) {
  const { renderCount } = usePerformance({
    componentName: 'MyComponent',
    trackRenders: true,
  })

  return <div>Rendered {renderCount} times</div>
}
```

## Track Component Lifecycle

```typescript
function MyComponent() {
  usePerformance({
    componentName: 'MyComponent',
    trackMounts: true,
    trackRenders: true,
  })

  // Component mount, unmount, and lifetime will be tracked
  return <div>Content</div>
}
```

## Measure Async Operations

```typescript
function DataComponent() {
  const { measureAsync } = usePerformance({
    componentName: 'DataComponent',
  })
  const [data, setData] = useState(null)

  useEffect(() => {
    measureAsync('fetch-data', async () => {
      const response = await fetch('/api/data')
      const json = await response.json()
      setData(json)
    })
  }, [measureAsync])

  return <div>{data ? 'Loaded' : 'Loading...'}</div>
}
```

## Performance Marks and Measures

```typescript
function ComplexComponent() {
  const { mark, measure } = usePerformance({
    componentName: 'ComplexComponent',
  })

  useEffect(() => {
    mark('start-processing')
    
    // Do some work
    processData()
    
    mark('end-processing')
    const duration = measure('processing', 'start-processing', 'end-processing')
    
    console.log(`Processing took ${duration}ms`)
  }, [mark, measure])

  return <div>Content</div>
}
```

## Real-World Example: Optimized Swap Card

```typescript
import { usePerformance } from '../hooks/usePerformance'
import { useCallback, useState } from 'react'

function SwapCard() {
  const { measureInteraction } = usePerformance({
    componentName: 'SwapCard',
    trackRenders: true,
  })

  const [amount, setAmount] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  // Measure dropdown toggle performance
  const toggleDropdown = useCallback(
    measureInteraction('toggle-dropdown', () => {
      setShowDropdown(prev => !prev)
    }),
    [measureInteraction]
  )

  // Measure swap execution
  const handleSwap = useCallback(
    measureInteraction('execute-swap', async () => {
      // Swap logic here
      await executeSwap(amount)
    }),
    [measureInteraction, amount]
  )

  return (
    <div>
      <button onClick={toggleDropdown}>
        Select Token
      </button>
      <button onClick={handleSwap}>
        Swap
      </button>
    </div>
  )
}
```

## useRenderPerformance Hook

Track render performance automatically:

```typescript
import { useRenderPerformance } from '../hooks/usePerformance'

function ExpensiveComponent({ data }) {
  // Will log warnings if render takes > 16ms
  useRenderPerformance('ExpensiveComponent', [data])

  return (
    <div>
      {/* Expensive rendering */}
    </div>
  )
}
```

## useEffectPerformance Hook

Measure effect execution time:

```typescript
import { useEffectPerformance } from '../hooks/usePerformance'

function DataFetchComponent() {
  const measureEffect = useEffectPerformance('DataFetchComponent')
  const [data, setData] = useState(null)

  useEffect(() => {
    measureEffect('initial-load', async () => {
      const result = await fetchData()
      setData(result)
    })
  }, [measureEffect])

  return <div>{data ? 'Loaded' : 'Loading...'}</div>
}
```

## Combining Multiple Hooks

```typescript
function AdvancedComponent({ userId }) {
  // Track overall performance
  const { measureInteraction, measureAsync } = usePerformance({
    componentName: 'AdvancedComponent',
    trackRenders: true,
    trackMounts: true,
  })

  // Track render performance
  useRenderPerformance('AdvancedComponent', [userId])

  // Track effect performance
  const measureEffect = useEffectPerformance('AdvancedComponent')

  const [user, setUser] = useState(null)

  useEffect(() => {
    measureEffect('fetch-user', async () => {
      const userData = await measureAsync('api-call', () =>
        fetch(`/api/users/${userId}`).then(r => r.json())
      )
      setUser(userData)
    })
  }, [userId, measureEffect, measureAsync])

  const handleUpdate = measureInteraction('update-user', async () => {
    await updateUser(user)
  })

  return (
    <div>
      <h1>{user?.name}</h1>
      <button onClick={handleUpdate}>Update</button>
    </div>
  )
}
```

## Best Practices

### 1. Use Descriptive Names

```typescript
// ✅ Good
measureInteraction('submit-form', handleSubmit)
measureAsync('fetch-user-profile', fetchProfile)

// ❌ Bad
measureInteraction('click', handleClick)
measureAsync('fetch', doFetch)
```

### 2. Measure Critical Interactions

```typescript
function CriticalComponent() {
  const { measureInteraction } = usePerformance({
    componentName: 'CriticalComponent',
  })

  // Measure user-facing interactions
  const handleSubmit = measureInteraction('form-submit', submitForm)
  const handleSearch = measureInteraction('search', performSearch)
  
  // Don't measure every tiny thing
  const handleHover = () => setHovered(true) // No need to measure
}
```

### 3. Combine with useCallback

```typescript
function OptimizedComponent() {
  const { measureInteraction } = usePerformance({
    componentName: 'OptimizedComponent',
  })

  // Combine measureInteraction with useCallback
  const handleClick = useCallback(
    measureInteraction('button-click', () => {
      doSomething()
    }),
    [measureInteraction]
  )

  return <button onClick={handleClick}>Click</button>
}
```

### 4. Track Expensive Components

```typescript
function ExpensiveList({ items }) {
  // Track if re-renders are slow
  useRenderPerformance('ExpensiveList', [items])

  const { measureInteraction } = usePerformance({
    componentName: 'ExpensiveList',
  })

  const handleSort = measureInteraction('sort-list', () => {
    sortItems(items)
  })

  return (
    <div>
      <button onClick={handleSort}>Sort</button>
      {items.map(item => <Item key={item.id} {...item} />)}
    </div>
  )
}
```

## Debugging with Performance Hooks

### View Metrics in Console

```javascript
// After interacting with components
window.__performanceMonitor.getSummary()

// Filter by component
window.__performanceMonitor.getAllMetrics()
  .forEach((metrics, name) => {
    if (name.includes('MyComponent')) {
      console.log(name, metrics)
    }
  })
```

### Find Slow Interactions

```javascript
// Get all slow interactions
window.__performanceMonitor.getINPEntries()
  .filter(e => e.duration > 200)
  .sort((a, b) => b.duration - a.duration)
  .forEach(e => console.log(e))
```

## Integration with Testing

```typescript
import { render, fireEvent } from '@testing-library/react'
import { performanceMonitor } from '../utils/performanceMonitor'

test('button click should be fast', () => {
  const { getByText } = render(<MyComponent />)
  
  performanceMonitor.clear()
  
  fireEvent.click(getByText('Click me'))
  
  const metrics = performanceMonitor.getMetrics('MyComponent-button-click')
  expect(metrics[0].value).toBeLessThan(200)
})
```

## Summary

The performance hooks provide:
- ✅ Easy component performance tracking
- ✅ Automatic slow interaction warnings
- ✅ Render performance monitoring
- ✅ Effect execution tracking
- ✅ Integration with performance monitor

Use them to ensure your components stay fast!

