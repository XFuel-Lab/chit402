# Maintenance Mode - Implementation Guide

## Overview

A full-screen maintenance mode overlay for the XFUEL swap dApp that can be toggled via environment variable. When enabled, it displays a beautiful, animated maintenance message while hiding all other app components behind a blurred backdrop.

## Features

- ✅ Full-screen overlay with `backdrop-filter: blur(10px)`
- ✅ Toggleable via `VITE_MAINTENANCE` environment variable
- ✅ Responsive design (mobile & desktop)
- ✅ Dark & light theme support
- ✅ Accessibility compliant (WCAG AA)
- ✅ Smooth animations and transitions
- ✅ Branded messaging with Twitter follow link

## Quick Start

### Enable Maintenance Mode

1. Create or edit `.env.local` file in project root:

```bash
# Enable maintenance mode
VITE_MAINTENANCE=true
```

2. Restart the dev server:

```bash
npm run dev
```

The maintenance overlay will now appear over the entire application.

### Disable Maintenance Mode

Set the environment variable to `false` or remove it:

```bash
# Disable maintenance mode
VITE_MAINTENANCE=false
```

## Files Structure

```
src/
├── components/
│   └── MaintenanceOverlay.tsx    # Main overlay component
├── styles/
│   └── maintenance.css            # Maintenance mode styles
├── index.css                      # Import maintenance styles
└── App.tsx                        # Integration point
```

## Component Details

### MaintenanceOverlay.tsx

The React component that renders the maintenance overlay. It accepts a single prop:

```typescript
interface MaintenanceOverlayProps {
  isEnabled: boolean  // Controls visibility
}
```

**Features:**
- Fade-in animation on mount
- Accessible with ARIA attributes
- Returns `null` when disabled (zero performance impact)
- Animated particles background
- Pulsing status indicator

### maintenance.css

Comprehensive CSS with:
- Full-screen backdrop blur effect
- Responsive breakpoints for mobile
- Light/dark theme variants
- Smooth keyframe animations
- Accessibility focus states

## Customization

### Change Message Text

Edit `src/components/MaintenanceOverlay.tsx`:

```tsx
<h1 id="maintenance-title" className="maintenance-title">
  Your Custom Title Here
</h1>

<p className="maintenance-message">
  Your custom message here
</p>
```

### Update Twitter Handle

Edit the Twitter link in `MaintenanceOverlay.tsx`:

```tsx
<a
  href="https://twitter.com/YourHandle"
  // ...
>
  @YourHandle
</a>
```

### Modify Colors

Edit `src/styles/maintenance.css`:

```css
/* Purple accent colors */
rgba(168, 85, 247, 0.X)  /* #a855f7 */

/* Cyan accent colors */
rgba(56, 189, 248, 0.X)   /* #38bdf8 */

/* Pink accent colors */
rgba(236, 72, 153, 0.X)   /* #ec4899 */
```

### Adjust Blur Intensity

In `maintenance.css`, modify the `.maintenance-overlay` class:

```css
.maintenance-overlay {
  backdrop-filter: blur(20px);  /* Increase from 10px */
  -webkit-backdrop-filter: blur(20px);
}
```

## Theme Support

### Dark Theme (Default)

Dark theme is the default appearance with purple/cyan neon aesthetics.

### Light Theme

Automatically adapts based on:
1. System preference: `prefers-color-scheme: light`
2. Explicit class: `<html class="dark">` or `<html data-theme="dark">`

Light theme features:
- White/light gray background gradients
- Adjusted text colors for readability
- Softer glow effects
- Higher contrast borders

## Deployment

### Development

```bash
# .env.local
VITE_MAINTENANCE=false
```

### Staging/Testing

```bash
# .env.staging
VITE_MAINTENANCE=true
```

### Production

Set via hosting platform environment variables:

**Vercel:**
```bash
vercel env add VITE_MAINTENANCE
# Value: true
```

**Netlify:**
```bash
# netlify.toml
[build.environment]
  VITE_MAINTENANCE = "true"
```

**Custom Server:**
```bash
export VITE_MAINTENANCE=true
npm run build
npm run preview
```

## Testing

### Manual Testing

1. Enable maintenance mode:
   ```bash
   VITE_MAINTENANCE=true npm run dev
   ```

2. Verify:
   - ✅ Full-screen overlay appears
   - ✅ Background is blurred
   - ✅ All components hidden behind overlay
   - ✅ Twitter link works
   - ✅ Animations are smooth
   - ✅ Responsive on mobile

3. Disable maintenance mode:
   ```bash
   VITE_MAINTENANCE=false npm run dev
   ```

4. Verify:
   - ✅ Overlay completely hidden
   - ✅ App functions normally

### Accessibility Testing

- Test with screen readers (NVDA, JAWS, VoiceOver)
- Verify keyboard navigation works
- Check color contrast ratios (use Chrome DevTools)
- Test with high contrast mode

## Performance

- **When disabled:** Zero overhead - component returns `null` immediately
- **When enabled:** Minimal impact - single overlay with CSS animations
- **Bundle size:** ~2KB (component + styles)

## Browser Support

- ✅ Chrome/Edge 76+
- ✅ Firefox 103+
- ✅ Safari 9+ (with `-webkit-backdrop-filter`)
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

**Note:** `backdrop-filter` has excellent support. Fallback solid background provided for older browsers.

## Troubleshooting

### Overlay not appearing

1. Check environment variable is set correctly:
   ```bash
   echo $VITE_MAINTENANCE  # Should output: true
   ```

2. Restart dev server after changing `.env` files

3. Clear browser cache

### Blur effect not working

- Check browser supports `backdrop-filter`
- Verify CSS is loaded (check DevTools Network tab)
- Try `-webkit-backdrop-filter` prefix (Safari)

### Styles not applied

1. Verify `maintenance.css` is imported in `index.css`
2. Check for CSS conflicts in DevTools
3. Clear Vite cache: `rm -rf node_modules/.vite`

## Integration Example

```tsx
// App.tsx
import MaintenanceOverlay from './components/MaintenanceOverlay'

function App() {
  // Read from environment variable
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true'
  
  return (
    <div>
      {/* Maintenance overlay - shows above everything */}
      <MaintenanceOverlay isEnabled={isMaintenanceMode} />
      
      {/* Your app components */}
      <YourAppContent />
    </div>
  )
}
```

## Advanced Configuration

### Scheduled Maintenance

Create a utility to auto-enable based on date/time:

```typescript
// src/utils/maintenanceSchedule.ts
export function isScheduledMaintenance(): boolean {
  const now = new Date()
  const maintenanceStart = new Date('2024-12-30T00:00:00Z')
  const maintenanceEnd = new Date('2024-12-30T04:00:00Z')
  
  return now >= maintenanceStart && now <= maintenanceEnd
}

// In App.tsx
const isMaintenanceMode = 
  import.meta.env.VITE_MAINTENANCE === 'true' || 
  isScheduledMaintenance()
```

### Custom Maintenance Reasons

Pass additional props for different maintenance types:

```typescript
interface MaintenanceOverlayProps {
  isEnabled: boolean
  reason?: 'upgrade' | 'security' | 'scheduled'
  estimatedTime?: string
}
```

## Support

For questions or issues:
- Email: xfuel.support@xfuel.app
- Twitter: [@XFuelLab](https://twitter.com/XFuelLab)

## License

Same as main project license.

