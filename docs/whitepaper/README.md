# XFUEL Whitepaper Generator

This directory contains tools to generate the XFUEL whitepaper in multiple formats with a cyberpunk/neon aesthetic.

## ✅ Status: Ready to Generate

The whitepaper content has been added and all infrastructure is set up. You're ready to generate the publication-ready PDF and Medium versions.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

   **Note**: The `canvas` package requires native dependencies. On Windows, you may need:
   - Python 3.x
   - Visual Studio Build Tools
   - Or use WSL/Linux
   
   If diagram generation fails, you can skip it and add diagrams manually later.

2. **Generate the whitepaper:**
   ```bash
   # Generate everything
   npm run whitepaper:all

   # Or step by step:
   npm run whitepaper:diagrams  # Create diagrams first
   npm run whitepaper:pdf       # Generate PDF
   npm run whitepaper:medium    # Generate Medium version
   ```

## Output Files

After generation, you'll find:

- `XFUEL-Whitepaper-v1.0.pdf` - High-res PDF for publication
- `whitepaper-preview.html` - HTML preview (open in browser)
- `XFUEL-Whitepaper-Medium.md` - Medium-ready Markdown
- `diagrams/revenue-flow.png` - Revenue & Token Flow diagram
- `diagrams/innovation-flywheel.png` - Innovation Flywheel diagram

## Content

The whitepaper content is in `whitepaper-content.md`:
- **Title**: XFUEL: The Perpetual Yield Pumping Station
- **Version**: v1.0 — December 18, 2025
- **Sections**: Abstract, Introduction, Tokenomics, Governance, etc.
- All tokenomics numbers and mechanics preserved exactly

## Design System

- **Colors**: Neon pink (#ff00ff), cyan (#00ffff), green (#00ff41), purple (#b026ff)
- **Background**: Dark (#0a0a0a) with grid/hologram effects
- **Fonts**: Orbitron (headers), Share Tech Mono (code), Rajdhani (body)
- **Effects**: Glassmorphism, neon glows, subtle animations

## Content Format

The whitepaper uses standard Markdown syntax with special placeholders:

- `[DIAGRAM: Revenue & Token Flow]` - Replaced with diagram container
- `[DIAGRAM: Innovation Flywheel]` - Replaced with diagram container
- `[SCREENSHOT: Label]` - Replaced with screenshot placeholder

## Diagrams

Two neon-styled diagrams are generated:

1. **Revenue & Token Flow** - Sankey diagram showing:
   - Revenue → 90% split to veXF (50% yield, 25% burn, 15% rXF)
   - Revenue → 10% to Treasury

2. **Innovation Flywheel** - Circular diagram showing:
   - Revenue → Treasury → Vaults → Spin-outs → TVL Growth → (loop)

## Troubleshooting

### Puppeteer Issues
If PDF generation fails, ensure Chrome/Chromium is installed or use:
```bash
npm install puppeteer --save-dev
```

### Canvas Issues (Windows)
If diagram generation fails on Windows:
1. Install Python 3.x
2. Install Visual Studio Build Tools
3. Or skip diagrams and add manually later

### Font Loading
Fonts are loaded from Google Fonts. Ensure internet connection for first generation, or download fonts locally.

## Final Commit

When ready, commit with:
```bash
git add docs/whitepaper/
git commit -m "docs: publish XFUEL whitepaper v1.0 — perpetual yield pumping station"
```

---

**Ready to generate! 🚀**
