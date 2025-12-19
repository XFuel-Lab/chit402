# XFUEL Whitepaper - Quick Start Guide

## ✅ What's Been Set Up

1. **Cyberpunk/Neon Design System** (`styles.css`)
   - Dark background with grid/hologram effects
   - Neon colors: pink, cyan, green, purple
   - Glassmorphism panels
   - Futuristic fonts (Orbitron, Share Tech Mono, Rajdhani)

2. **PDF Generator** (`generate-pdf.mjs`)
   - Converts Markdown to HTML
   - Generates high-res PDF using Puppeteer
   - Includes cover page with title and date

3. **Medium Markdown Generator** (`generate-medium.mjs`)
   - Creates Medium-ready Markdown
   - Cleans up formatting for publication

4. **Diagram Generator** (`create-diagrams.mjs`)
   - Revenue & Token Flow diagram (Sankey-style)
   - Innovation Flywheel (circular diagram)

## 📝 Next Steps

### 1. Add Your Whitepaper Content

Edit `whitepaper-content.md` and paste your full whitepaper content starting with:

```markdown
# XFUEL: The Perpetual Yield Pumping Station

[Your content here...]
```

### 2. Install Dependencies

```bash
npm install
```

**Note**: The `canvas` package requires native dependencies. On Windows, you may need:
- Python 3.x
- Visual Studio Build Tools
- Or use WSL/Linux

If diagram generation fails, you can skip it and add diagrams manually later.

### 3. Generate Whitepaper

```bash
# Generate everything
npm run whitepaper:all

# Or step by step:
npm run whitepaper:diagrams  # Create diagrams
npm run whitepaper:pdf       # Generate PDF
npm run whitepaper:medium    # Generate Medium version
```

## 📋 Content Format Guide

### Headers
```markdown
# Main Title
## Section
### Subsection
#### Sub-subsection
```

### Text Formatting
```markdown
**bold text**
*italic text*
`code`
```

### Lists
```markdown
- Item 1
- Item 2

1. Numbered item
2. Another item
```

### Tables
```markdown
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
```

### Diagrams
```markdown
[DIAGRAM: Revenue & Token Flow]
[DIAGRAM: Innovation Flywheel]
```

### Screenshots
```markdown
[SCREENSHOT: Swap Screen]
[SCREENSHOT: Dashboard]
[SCREENSHOT: Mobile App]
```

## 🎨 Design Customization

Edit `styles.css` to customize:
- Colors (CSS variables in `:root`)
- Fonts (Google Fonts imports)
- Effects (glows, shadows, animations)

## 📄 Output Files

After generation, you'll find:

- `XFUEL-Whitepaper-v1.0.pdf` - Publication-ready PDF
- `whitepaper-preview.html` - Preview in browser
- `XFUEL-Whitepaper-Medium.md` - Medium post
- `diagrams/revenue-flow.png` - Revenue diagram
- `diagrams/innovation-flywheel.png` - Flywheel diagram

## 🐛 Troubleshooting

### Puppeteer Issues
If PDF generation fails, ensure Chrome/Chromium is installed or use:
```bash
npm install puppeteer --save-dev
```

### Canvas Issues (Windows)
If diagram generation fails on Windows:
1. Install Python 3.x
2. Install Visual Studio Build Tools
3. Or skip diagrams and add manually

### Font Loading
Fonts are loaded from Google Fonts. Ensure internet connection for first generation, or download fonts locally.

## 📞 Need Help?

Check the main README.md in this directory for more details.

