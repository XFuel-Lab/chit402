#!/usr/bin/env node

/**
 * Generate PDF from XFUEL ZK Bridge Whitepaper
 * 
 * Usage:
 *   npm install -g marked puppeteer
 *   node generate-pdf-v2.mjs
 * 
 * Output: XFUEL-ZK-Bridge-Whitepaper.pdf
 */

import { marked } from 'marked'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import puppeteer from 'puppeteer'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Read markdown file
console.log('📖 Reading whitepaper markdown...')
const markdownPath = join(__dirname, 'XFUEL-ZK-Bridge-Whitepaper.md')
const markdown = readFileSync(markdownPath, 'utf-8')

// Configure marked with options for clean output
marked.setOptions({
  breaks: false,
  gfm: true,
  headerIds: true,
  mangle: false,
})

// Convert markdown to HTML
console.log('🔄 Converting markdown to HTML...')
const contentHtml = marked(markdown)

// Create styled HTML document
const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XFUEL: Zero-Knowledge Bridge for Cross-Chain Yield Automation</title>
  <style>
    /* PDF-optimized styles */
    @page {
      size: A4;
      margin: 2cm 1.5cm;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 10pt;
      line-height: 1.6;
      color: #1a1a1a;
      background: white;
      max-width: 100%;
      padding: 0;
    }
    
    /* Headers */
    h1 {
      font-size: 24pt;
      font-weight: 700;
      margin: 1.5em 0 0.5em;
      color: #6366f1;
      border-bottom: 3px solid #6366f1;
      padding-bottom: 0.3em;
      page-break-after: avoid;
    }
    
    h1:first-of-type {
      margin-top: 0;
      font-size: 28pt;
      text-align: center;
      border-bottom: none;
    }
    
    h2 {
      font-size: 18pt;
      font-weight: 600;
      margin: 1.2em 0 0.5em;
      color: #4f46e5;
      page-break-after: avoid;
    }
    
    h3 {
      font-size: 14pt;
      font-weight: 600;
      margin: 1em 0 0.4em;
      color: #6366f1;
      page-break-after: avoid;
    }
    
    h4 {
      font-size: 12pt;
      font-weight: 600;
      margin: 0.8em 0 0.3em;
      color: #818cf8;
      page-break-after: avoid;
    }
    
    /* Paragraphs */
    p {
      margin: 0.5em 0;
      text-align: justify;
      orphans: 3;
      widows: 3;
    }
    
    /* Links */
    a {
      color: #6366f1;
      text-decoration: none;
      border-bottom: 1px dotted #6366f1;
    }
    
    /* Lists */
    ul, ol {
      margin: 0.5em 0 0.5em 1.5em;
      padding-left: 0;
    }
    
    li {
      margin: 0.3em 0;
      page-break-inside: avoid;
    }
    
    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      font-size: 9pt;
      page-break-inside: avoid;
    }
    
    th {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: white;
      font-weight: 600;
      padding: 8px;
      text-align: left;
      border: 1px solid #4f46e5;
    }
    
    td {
      padding: 6px 8px;
      border: 1px solid #e0e0e0;
    }
    
    tr:nth-child(even) {
      background-color: #f9fafb;
    }
    
    /* Code blocks */
    code {
      font-family: 'Courier New', Courier, monospace;
      font-size: 8pt;
      background: #f3f4f6;
      padding: 2px 4px;
      border-radius: 3px;
      color: #dc2626;
    }
    
    pre {
      background: #1e293b;
      color: #e2e8f0;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 0.8em 0;
      page-break-inside: avoid;
      font-size: 8pt;
      line-height: 1.4;
    }
    
    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
      font-size: inherit;
    }
    
    /* Blockquotes */
    blockquote {
      border-left: 4px solid #6366f1;
      margin: 1em 0;
      padding: 0.5em 0 0.5em 1em;
      background: #f9fafb;
      font-style: italic;
      page-break-inside: avoid;
    }
    
    /* Horizontal rules */
    hr {
      border: none;
      border-top: 2px solid #e5e7eb;
      margin: 2em 0;
    }
    
    /* Page breaks */
    .page-break {
      page-break-after: always;
    }
    
    /* Table of contents */
    .toc {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      padding: 1.5em;
      margin: 2em 0;
      page-break-inside: avoid;
    }
    
    .toc h2 {
      margin-top: 0;
      color: #1f2937;
    }
    
    .toc ul {
      list-style: none;
      margin-left: 0;
    }
    
    .toc li {
      margin: 0.3em 0;
    }
    
    /* Risk severity indicators */
    .risk-critical { color: #dc2626; font-weight: 600; }
    .risk-medium { color: #f59e0b; font-weight: 600; }
    .risk-low { color: #10b981; font-weight: 600; }
    
    /* Emojis */
    .emoji {
      font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
    }
    
    /* Footer */
    .footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 8pt;
      color: #6b7280;
      padding: 0.5em 0;
      border-top: 1px solid #e5e7eb;
    }
    
    /* Abstract box */
    .abstract {
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      border: 2px solid #6366f1;
      border-radius: 8px;
      padding: 1.5em;
      margin: 1em 0 2em;
      page-break-inside: avoid;
    }
    
    /* Print optimizations */
    @media print {
      body {
        font-size: 10pt;
      }
      
      a {
        color: #1f2937;
        border-bottom: none;
      }
      
      pre {
        border: 1px solid #e5e7eb;
      }
    }
  </style>
</head>
<body>
  <div class="content">
    ${contentHtml}
  </div>
</body>
</html>
`

// Generate PDF using Puppeteer
console.log('🚀 Launching headless browser...')
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
})

const page = await browser.newPage()

console.log('📄 Generating PDF...')
await page.setContent(html, { waitUntil: 'networkidle0' })

const pdfPath = join(__dirname, 'XFUEL-ZK-Bridge-Whitepaper.pdf')
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: {
    top: '2cm',
    right: '1.5cm',
    bottom: '2cm',
    left: '1.5cm'
  },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="width: 100%; font-size: 8pt; color: #6b7280; text-align: center; padding: 10px 0;">
      <span>XFUEL: Zero-Knowledge Bridge for Cross-Chain Yield Automation</span>
      <span style="float: right; margin-right: 1.5cm;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  `
})

await browser.close()

console.log('✅ PDF generated successfully!')
console.log(`📁 Output: ${pdfPath}`)
console.log(`📊 Size: ${(readFileSync(pdfPath).length / 1024 / 1024).toFixed(2)} MB`)

// Also save HTML for preview
const htmlPath = join(__dirname, 'XFUEL-ZK-Bridge-Whitepaper.html')
writeFileSync(htmlPath, html, 'utf-8')
console.log(`🌐 HTML preview: ${htmlPath}`)

console.log('\n🎉 Whitepaper PDF generation complete!')
console.log('Next steps:')
console.log('  1. Review the PDF: open docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.pdf')
console.log('  2. Upload to GitHub: git add docs/whitepaper/*.pdf && git commit -m "Add ZK bridge whitepaper PDF"')
console.log('  3. Publish on website: Copy to public/ directory')

