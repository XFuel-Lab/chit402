# 🔧 Maintenance Mode - Code Snippets

Quick copy-paste code snippets for common customizations.

---

## 📝 Environment Variables

### Enable Maintenance Mode
```bash
# .env.local
VITE_MAINTENANCE=true
```

### Disable Maintenance Mode
```bash
# .env.local
VITE_MAINTENANCE=false
```

### Production Deployment
```bash
# Vercel
vercel env add VITE_MAINTENANCE production
# Enter: true

# Netlify (netlify.toml)
[build.environment]
  VITE_MAINTENANCE = "true"

# Docker
ENV VITE_MAINTENANCE=true

# Shell export
export VITE_MAINTENANCE=true
npm run build
```

---

## 🎨 Text Customization

### Change Main Title
```tsx
// src/components/MaintenanceOverlay.tsx
<h1 id="maintenance-title" className="maintenance-title">
  Your Custom Title Here
</h1>
```

### Change Subtitle
```tsx
// src/components/MaintenanceOverlay.tsx
<p className="maintenance-message">
  Your custom subtitle or message
</p>
```

### Change Announcement
```tsx
// src/components/MaintenanceOverlay.tsx
<p className="maintenance-announcement-text">
  Your exciting announcement here!
</p>
```

### Change Twitter Handle
```tsx
// src/components/MaintenanceOverlay.tsx
<a
  href="https://twitter.com/YourHandle"
  target="_blank"
  rel="noopener noreferrer"
  className="maintenance-twitter-link"
>
  <svg>...</svg>
  @YourHandle
</a>
```

---

## 🎨 Color Customization

### Change Primary Color (Purple)
```css
/* src/styles/maintenance.css */
/* Find and replace all instances of: */
rgba(168, 85, 247, /* opacity */)
/* With your color: */
rgba(R, G, B, /* opacity */)
```

### Change Secondary Color (Cyan)
```css
/* src/styles/maintenance.css */
/* Find and replace all instances of: */
rgba(56, 189, 248, /* opacity */)
/* With your color: */
rgba(R, G, B, /* opacity */)
```

### Change Accent Color (Pink)
```css
/* src/styles/maintenance.css */
/* Find and replace all instances of: */
rgba(236, 72, 153, /* opacity */)
/* With your color: */
rgba(R, G, B, /* opacity */)
```

### Using CSS Variables (Recommended)
```css
/* Add to src/styles/maintenance.css at top */
:root {
  --maintenance-primary: rgba(168, 85, 247, 1);
  --maintenance-secondary: rgba(56, 189, 248, 1);
  --maintenance-accent: rgba(236, 72, 153, 1);
  --maintenance-status: rgba(239, 68, 68, 1);
}

/* Then replace colors throughout file: */
.maintenance-inner {
  border: 2px solid var(--maintenance-primary);
  /* etc */
}
```

---

## 🖼️ Visual Customization

### Change Blur Amount
```css
/* src/styles/maintenance.css */
.maintenance-overlay {
  backdrop-filter: blur(20px);  /* Change from 10px */
  -webkit-backdrop-filter: blur(20px);
  background: rgba(0, 0, 0, 0.90);  /* Adjust darkness */
}
```

### Change Icon/Emoji
```tsx
// src/components/MaintenanceOverlay.tsx
<span className="maintenance-icon-emoji">
  🚧  {/* Change emoji */}
</span>
```

### Change Card Border Radius
```css
/* src/styles/maintenance.css */
.maintenance-inner {
  border-radius: 3rem;  /* Change from 2rem */
}
```

### Change Animation Speed
```css
/* src/styles/maintenance.css */

/* Particle movement */
@keyframes maintenance-particles {
  /* Change duration from 20s */
}
.maintenance-particles {
  animation: maintenance-particles 30s linear infinite alternate;
}

/* Card pulse */
.maintenance-inner {
  animation: maintenance-pulse 5s ease-in-out infinite;  /* Change from 3s */
}

/* Icon float */
.maintenance-icon {
  animation: maintenance-icon-float 5s ease-in-out infinite;  /* Change from 3s */
}
```

---

## 🎯 Integration Patterns

### Basic Integration
```tsx
// src/App.tsx
import MaintenanceOverlay from './components/MaintenanceOverlay'

function App() {
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true'
  
  return (
    <>
      <MaintenanceOverlay isEnabled={isMaintenanceMode} />
      <YourAppContent />
    </>
  )
}
```

### With React Router
```tsx
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MaintenanceOverlay from './components/MaintenanceOverlay'

function App() {
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true'
  
  return (
    <BrowserRouter>
      <MaintenanceOverlay isEnabled={isMaintenanceMode} />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/swap" element={<Swap />} />
        {/* More routes */}
      </Routes>
    </BrowserRouter>
  )
}
```

### With State Management
```tsx
// src/App.tsx
import { useState } from 'react'
import MaintenanceOverlay from './components/MaintenanceOverlay'

function App() {
  // Can be controlled via state for admin override
  const [maintenanceOverride, setMaintenanceOverride] = useState(false)
  const envMaintenance = import.meta.env.VITE_MAINTENANCE === 'true'
  const isMaintenanceMode = envMaintenance || maintenanceOverride
  
  return (
    <>
      <MaintenanceOverlay isEnabled={isMaintenanceMode} />
      <YourAppContent />
    </>
  )
}
```

### With Layout Component
```tsx
// src/Layout.tsx
import MaintenanceOverlay from './components/MaintenanceOverlay'

function Layout({ children }) {
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true'
  
  return (
    <div className="app-layout">
      <MaintenanceOverlay isEnabled={isMaintenanceMode} />
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
```

---

## ⏰ Scheduled Maintenance

### Time-Based Auto-Enable
```typescript
// src/utils/maintenanceSchedule.ts
export function isScheduledMaintenance(): boolean {
  const now = new Date()
  
  // Define maintenance windows
  const windows = [
    {
      start: new Date('2024-12-30T00:00:00Z'),
      end: new Date('2024-12-30T04:00:00Z'),
    },
    {
      start: new Date('2025-01-15T02:00:00Z'),
      end: new Date('2025-01-15T06:00:00Z'),
    },
  ]
  
  return windows.some(window => now >= window.start && now <= window.end)
}

// In App.tsx:
import { isScheduledMaintenance } from './utils/maintenanceSchedule'

const isMaintenanceMode = 
  import.meta.env.VITE_MAINTENANCE === 'true' || 
  isScheduledMaintenance()
```

### Recurring Maintenance
```typescript
// src/utils/maintenanceSchedule.ts
export function isRecurringMaintenance(): boolean {
  const now = new Date()
  const day = now.getUTCDay() // 0 = Sunday, 1 = Monday, etc.
  const hour = now.getUTCHours()
  
  // Every Sunday 2-4 AM UTC
  return day === 0 && hour >= 2 && hour < 4
}
```

---

## 📊 Analytics Integration

### Track Maintenance Views
```typescript
// src/components/MaintenanceOverlay.tsx
import { useEffect } from 'react'

export default function MaintenanceOverlay({ isEnabled }: MaintenanceOverlayProps) {
  useEffect(() => {
    if (isEnabled) {
      // Google Analytics
      if (typeof gtag !== 'undefined') {
        gtag('event', 'page_view', {
          page_title: 'Maintenance Mode',
          page_location: window.location.href,
        })
      }
      
      // Custom analytics
      fetch('/api/analytics/maintenance-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          referrer: document.referrer,
        }),
      })
    }
  }, [isEnabled])
  
  // ... rest of component
}
```

### Track Twitter Clicks
```tsx
// src/components/MaintenanceOverlay.tsx
<a
  href="https://twitter.com/XFuelLab"
  target="_blank"
  rel="noopener noreferrer"
  className="maintenance-twitter-link"
  onClick={(e) => {
    // Track click before navigation
    if (typeof gtag !== 'undefined') {
      gtag('event', 'click', {
        event_category: 'Maintenance',
        event_label: 'Twitter Link',
      })
    }
  }}
>
  @XFuelLab
</a>
```

---

## 🔐 Admin Override

### Remote Control via API
```typescript
// src/App.tsx
import { useState, useEffect } from 'react'
import MaintenanceOverlay from './components/MaintenanceOverlay'

function App() {
  const [remoteMaintenanceMode, setRemoteMaintenanceMode] = useState(false)
  const envMaintenance = import.meta.env.VITE_MAINTENANCE === 'true'
  
  // Check remote maintenance status
  useEffect(() => {
    fetch('/api/maintenance-status')
      .then(res => res.json())
      .then(data => setRemoteMaintenanceMode(data.isEnabled))
      .catch(() => {})
  }, [])
  
  const isMaintenanceMode = envMaintenance || remoteMaintenanceMode
  
  return (
    <>
      <MaintenanceOverlay isEnabled={isMaintenanceMode} />
      <YourAppContent />
    </>
  )
}
```

### Backend API Example
```typescript
// api/maintenance-status.ts (Next.js API route example)
export default async function handler(req, res) {
  // Check maintenance flag in database/config
  const isEnabled = await db.maintenanceSettings.findOne()
  
  res.status(200).json({
    isEnabled: isEnabled?.active || false,
    reason: isEnabled?.reason || 'upgrade',
    estimatedEnd: isEnabled?.estimatedEnd || null,
  })
}
```

---

## 🎨 Extended Props Pattern

### Add More Options
```typescript
// src/components/MaintenanceOverlay.tsx
interface MaintenanceOverlayProps {
  isEnabled: boolean
  reason?: 'upgrade' | 'security' | 'scheduled' | 'emergency'
  estimatedTime?: string
  contactEmail?: string
  showCountdown?: boolean
}

export default function MaintenanceOverlay({ 
  isEnabled,
  reason = 'upgrade',
  estimatedTime,
  contactEmail = 'xfuel.support@xfuel.app',
  showCountdown = false,
}: MaintenanceOverlayProps) {
  // ... component logic
  
  return (
    <div className="maintenance-overlay">
      {/* Dynamic message based on reason */}
      {reason === 'security' && (
        <p>Security update in progress</p>
      )}
      
      {/* Show countdown if enabled */}
      {showCountdown && estimatedTime && (
        <Countdown targetTime={estimatedTime} />
      )}
      
      {/* Dynamic contact */}
      <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
    </div>
  )
}
```

### Usage with Extended Props
```tsx
// src/App.tsx
<MaintenanceOverlay 
  isEnabled={isMaintenanceMode}
  reason="security"
  estimatedTime="2024-12-30T04:00:00Z"
  contactEmail="urgent@xfuel.app"
  showCountdown={true}
/>
```

---

## 🧪 Testing Utilities

### Test Helper
```typescript
// src/utils/testMaintenance.ts
export function enableMaintenanceForTesting() {
  localStorage.setItem('test-maintenance-mode', 'true')
  window.location.reload()
}

export function disableMaintenanceForTesting() {
  localStorage.removeItem('test-maintenance-mode')
  window.location.reload()
}

// In App.tsx:
const isMaintenanceMode = 
  import.meta.env.VITE_MAINTENANCE === 'true' ||
  (import.meta.env.MODE === 'development' && 
   localStorage.getItem('test-maintenance-mode') === 'true')
```

### Browser Console Commands
```javascript
// In browser console:

// Enable maintenance mode (dev only)
localStorage.setItem('test-maintenance-mode', 'true')
location.reload()

// Disable maintenance mode (dev only)
localStorage.removeItem('test-maintenance-mode')
location.reload()
```

---

## 🚀 Quick Commands

```bash
# Enable maintenance mode locally
echo "VITE_MAINTENANCE=true" > .env.local && npm run dev

# Disable maintenance mode locally
echo "VITE_MAINTENANCE=false" > .env.local && npm run dev

# Build with maintenance enabled
VITE_MAINTENANCE=true npm run build

# Preview production build
npm run preview

# Toggle using script (Unix)
./toggle-maintenance.sh

# Toggle using script (Windows)
toggle-maintenance.bat

# Check current status
grep VITE_MAINTENANCE .env.local

# Remove all maintenance config
rm .env.local
```

---

## 📦 Component Export

### Named Export
```typescript
// src/components/MaintenanceOverlay.tsx
export { MaintenanceOverlay }

// Usage:
import { MaintenanceOverlay } from './components/MaintenanceOverlay'
```

### Default Export (Current)
```typescript
// src/components/MaintenanceOverlay.tsx
export default function MaintenanceOverlay({ isEnabled }: MaintenanceOverlayProps)

// Usage:
import MaintenanceOverlay from './components/MaintenanceOverlay'
```

### Re-export from Index
```typescript
// src/components/index.ts
export { default as MaintenanceOverlay } from './MaintenanceOverlay'

// Usage:
import { MaintenanceOverlay } from './components'
```

---

## 🎭 Conditional Rendering Patterns

### Pattern 1: Early Return
```tsx
function App() {
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true'
  
  if (isMaintenanceMode) {
    return <MaintenanceOverlay isEnabled={true} />
  }
  
  return <YourAppContent />
}
```

### Pattern 2: Conditional Render (Current)
```tsx
function App() {
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true'
  
  return (
    <>
      <MaintenanceOverlay isEnabled={isMaintenanceMode} />
      <YourAppContent />
    </>
  )
}
```

### Pattern 3: Ternary Operator
```tsx
function App() {
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true'
  
  return isMaintenanceMode ? (
    <MaintenanceOverlay isEnabled={true} />
  ) : (
    <YourAppContent />
  )
}
```

---

**Last Updated:** December 29, 2025  
**Snippets Version:** 1.0.0  
**Compatible With:** React 18+, Vite 4+

