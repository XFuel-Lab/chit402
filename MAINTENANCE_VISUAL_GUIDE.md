# 🎨 Maintenance Mode - Visual Guide

## What It Looks Like

### When ENABLED (`VITE_MAINTENANCE=true`)

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║  [Blurred app content in background - not interactive]  ║
║                                                          ║
║    ┌────────────────────────────────────────┐          ║
║    │                                        │          ║
║    │           ┌─────────────┐             │          ║
║    │           │   🚀 Icon   │ (floating)  │          ║
║    │           │  (animated) │             │          ║
║    │           └─────────────┘             │          ║
║    │                                        │          ║
║    │    PROJECT UNDER CONSTRUCTION          │          ║
║    │                                        │          ║
║    │   Temporarily Out of Service          │          ║
║    │                                        │          ║
║    │  ╔════════════════════════════════╗   │          ║
║    │  ║ ⚡ Exciting ZK Upgrades       ║   │          ║
║    │  ║    Coming Soon!               ║   │          ║
║    │  ╚════════════════════════════════╝   │          ║
║    │                                        │          ║
║    │        Follow for Updates              │          ║
║    │    ┌─────────────────────────┐        │          ║
║    │    │  🐦 @XFuelLab          │        │          ║
║    │    │  (clickable link)       │        │          ║
║    │    └─────────────────────────┘        │          ║
║    │                                        │          ║
║    │         🔴 Under Maintenance           │          ║
║    │           (blinking indicator)         │          ║
║    │                                        │          ║
║    └────────────────────────────────────────┘          ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

Legend:
- Background: Black/dark with blur effect
- Card: Glass morphism with purple/cyan glow
- Text: White with gradient effects
- Animations: Particle field, floating icon, pulsing glow
```

### When DISABLED (`VITE_MAINTENANCE=false` or not set)

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║  [Normal app - fully functional and interactive]        ║
║                                                          ║
║  ┌─ XFUEL Header ─────────────────────────────┐        ║
║  │  Logo | Swap | Bridge | Profile           │        ║
║  └────────────────────────────────────────────┘        ║
║                                                          ║
║  ┌─ Swap Card ──────────────────────────────┐          ║
║  │  From: TFUEL                             │          ║
║  │  To: stkATOM                             │          ║
║  │  [Swap Button]                           │          ║
║  └──────────────────────────────────────────┘          ║
║                                                          ║
║  [All features work normally]                           ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

Note: No overlay, no blur, app works 100% normally
```

---

## 🎨 Color Scheme

### Dark Theme (Default)

```
Background:
  - Main: rgba(0, 0, 0, 0.85) with 10px blur
  - Card: rgba(15, 23, 42, 0.95) → rgba(30, 41, 59, 0.90) gradient

Text Colors:
  - Title: Purple (#a855f7) → Cyan (#06b6d4) → Pink (#ec4899) gradient
  - Subtitle: White rgba(226, 232, 240, 0.9)
  - Body: Slate rgba(148, 163, 184, 0.8)

Accents:
  - Primary: Purple rgba(168, 85, 247, X)
  - Secondary: Cyan rgba(56, 189, 248, X)
  - Tertiary: Pink rgba(236, 72, 153, X)
  - Status: Red rgba(239, 68, 68, X)

Glows:
  - Card: 0 0 60px rgba(168, 85, 247, 0.4)
  - Title: 0 0 30px rgba(168, 85, 247, 0.5)
  - Icon: 0 0 40px rgba(168, 85, 247, 0.6)
  - Button hover: 0 0 20px rgba(6, 182, 212, 0.4)
```

### Light Theme (Auto-detect)

```
Background:
  - Main: rgba(255, 255, 255, 0.90) with 10px blur
  - Card: rgba(248, 250, 252, 0.95) → rgba(241, 245, 249, 0.90) gradient

Text Colors:
  - Title: Deeper purple (#7c3aed) → blue (#0284c7) → pink (#db2777)
  - Subtitle: Dark slate rgba(15, 23, 42, 0.9)
  - Body: Medium slate rgba(71, 85, 105, 0.8)

Accents:
  - Primary: Darker purple rgba(124, 58, 237, X)
  - Secondary: Darker cyan rgba(2, 132, 199, X)
  - Tertiary: Darker pink rgba(219, 39, 119, X)
  - Status: Darker red rgba(220, 38, 38, X)

Glows: (softer)
  - Card: 0 0 40px rgba(168, 85, 247, 0.2)
  - All effects at 50% intensity of dark theme
```

---

## 📐 Layout Dimensions

### Desktop (> 640px)
```
Overlay: 100vw × 100vh (full screen)
Content card: max-width: 42rem (672px)
Padding: 3rem 2rem
Icon size: 6rem (96px)
Title: 2.5rem (40px)
Subtitle: 1.25rem (20px)
Button: 1.125rem (18px)
```

### Mobile (≤ 640px)
```
Overlay: 100vw × 100vh (full screen)
Content card: max-width: 100% - 2rem padding
Padding: 2rem 1.5rem
Icon size: 5rem (80px)
Title: 1.75rem (28px)
Subtitle: 1rem (16px)
Button: 1rem (16px)
```

---

## 🎬 Animations

### 1. Overlay Fade In
```css
Duration: 0.5s
Timing: ease-out
Effect: opacity 0 → 1
```

### 2. Particle Field
```css
Duration: 20s
Timing: linear infinite alternate
Effect: translate + scale
Range: -10px to +20px horizontal, -10px to +15px vertical
```

### 3. Card Pulse
```css
Duration: 3s
Timing: ease-in-out infinite
Effect: box-shadow glow intensity
Range: 60px → 80px blur radius
```

### 4. Icon Float
```css
Duration: 3s
Timing: ease-in-out infinite
Effect: translateY
Range: 0 → -10px vertical
```

### 5. Title Glow
```css
Duration: 2s
Timing: ease-in-out infinite
Effect: drop-shadow
Range: 20px → 30px blur
```

### 6. Announcement Sparkle
```css
Duration: 1.5s
Timing: ease-in-out infinite
Effect: scale + rotate + opacity
Range: scale(1) → scale(1.2), rotate(0deg) → rotate(10deg)
```

### 7. Status Blink
```css
Duration: 2s
Timing: ease-in-out infinite
Effect: opacity
Range: 1 → 0.3 → 1
```

### 8. Button Hover
```css
Duration: 0.3s
Timing: ease
Effect: background, border, box-shadow, transform
Result: Lift effect with enhanced glow
```

---

## 🔧 CSS Class Structure

```
.maintenance-overlay              → Full screen container
  .maintenance-content            → Centered wrapper
    .maintenance-particles        → Animated background
    .maintenance-inner            → Main card
      .maintenance-icon-wrapper   → Icon container
        .maintenance-icon         → Icon circle
          .maintenance-icon-emoji → Emoji/content
      .maintenance-title          → Main heading
      .maintenance-message        → Subtitle
      .maintenance-announcement   → Info box
        .maintenance-announcement-icon
        .maintenance-announcement-text
      .maintenance-follow         → Social section
        .maintenance-follow-text
        .maintenance-twitter-link
          .maintenance-twitter-icon
      .maintenance-status         → Status badge
        .maintenance-status-indicator
        .maintenance-status-text
```

---

## 🎯 Interactive States

### Twitter Button States

**Default:**
```css
background: rgba(6, 182, 212, 0.1)
border: 1px solid rgba(6, 182, 212, 0.3)
color: #06b6d4
```

**Hover:**
```css
background: rgba(6, 182, 212, 0.2)
border: 1px solid rgba(6, 182, 212, 0.5)
box-shadow: 0 0 20px rgba(6, 182, 212, 0.4)
transform: translateY(-2px)
```

**Focus (keyboard):**
```css
outline: 2px solid rgba(6, 182, 212, 0.8)
outline-offset: 2px
```

**Active (click):**
```css
transform: translateY(0)
```

---

## 📱 Responsive Breakpoints

```
Mobile:    0px - 639px   (single column, compact)
Tablet:    640px - 1023px (optimized for touch)
Desktop:   1024px+        (full layout)
```

### Mobile Adjustments:
- Smaller icon (5rem vs 6rem)
- Reduced title size (1.75rem vs 2.5rem)
- Tighter padding (1.5rem vs 2rem)
- Stacked layout for all elements
- Touch-optimized button sizes (min 44px)

---

## 🎨 Theme Detection

### Automatic (System Preference)
```css
@media (prefers-color-scheme: light) {
  /* Light theme styles */
}
```

### Manual (Class-based)
```css
[data-theme="dark"] .maintenance-overlay,
.dark .maintenance-overlay {
  /* Dark theme styles */
}
```

### Priority:
1. Explicit class (`<html class="dark">`)
2. System preference (`prefers-color-scheme`)
3. Default (dark theme)

---

## 🌐 Browser Compatibility

### backdrop-filter Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 76+ | ✅ Native |
| Firefox | 103+ | ✅ Native |
| Safari | 9+ | ✅ With `-webkit-` |
| Edge | 79+ | ✅ Native (Chromium) |
| Opera | 63+ | ✅ Native |
| iOS Safari | 9+ | ✅ With `-webkit-` |
| Chrome Android | 76+ | ✅ Native |

**Fallback:** Solid background if blur not supported

---

## ✨ Visual Hierarchy

```
Level 1 (Most prominent):
  - Animated icon
  - Main title with gradient
  - Card glow effect

Level 2 (Secondary):
  - Subtitle text
  - Announcement box
  - Particle field

Level 3 (Supporting):
  - Follow text
  - Twitter button
  - Status indicator
```

---

## 🎭 Accessibility Features

✅ **Semantic HTML:** Proper heading hierarchy (h1)  
✅ **ARIA Labels:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby`  
✅ **Keyboard Nav:** Tab-accessible, focus states visible  
✅ **Screen Readers:** Descriptive link text, status announcements  
✅ **Color Contrast:** WCAG AA compliant (4.5:1 minimum)  
✅ **Focus Indicators:** 2px solid outline with 2px offset  
✅ **Skip Links:** Not needed (single purpose page)  

---

**Created:** December 29, 2025  
**Style Guide Version:** 1.0.0  
**Design System:** XFUEL Neon/Glass

