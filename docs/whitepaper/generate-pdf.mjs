import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the whitepaper content
const contentPath = path.join(__dirname, 'whitepaper-content.md');
const stylesPath = path.join(__dirname, 'styles.css');
const templatePath = path.join(__dirname, 'template.html');

async function generatePDF() {
  console.log('🚀 Generating XFUEL Whitepaper PDF...\n');

  // Read content
  const content = fs.readFileSync(contentPath, 'utf-8');
  const styles = fs.readFileSync(stylesPath, 'utf-8');
  
  // Convert markdown to HTML (simple conversion for now)
  const html = convertMarkdownToHTML(content, styles);

  // Write HTML file for preview
  const htmlOutputPath = path.join(__dirname, 'whitepaper-preview.html');
  fs.writeFileSync(htmlOutputPath, html);
  console.log('✅ HTML preview generated:', htmlOutputPath);

  // Generate PDF using Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Set viewport for better rendering
  await page.setViewport({ width: 1200, height: 1600 });
  
  // Set content - Puppeteer will handle file:// URLs
  await page.setContent(html, { 
    waitUntil: 'networkidle0'
  });

  const pdfPath = path.join(__dirname, 'XFUEL-Whitepaper-v1.0.pdf');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '2cm',
      right: '2cm',
      bottom: '2cm',
      left: '2cm'
    }
  });

  await browser.close();

  console.log('✅ PDF generated:', pdfPath);
  console.log('\n📄 Whitepaper generation complete!');
}

function convertMarkdownToHTML(markdown, styles) {
  let html = markdown;

  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // Convert code blocks first (before other processing)
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code>${escapeHTML(code.trim())}</code></pre>`;
  });

  // Convert inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Convert tables (markdown table format)
  const tableRegex = /(\|.+\|\n\|[:\-| ]+\|\n(?:\|.+\|\n?)+)/g;
  html = html.replace(tableRegex, (match) => {
    const lines = match.trim().split('\n');
    const headerRow = lines[0];
    const separatorRow = lines[1];
    const dataRows = lines.slice(2);

    const headers = headerRow.split('|').map(c => c.trim()).filter(c => c);
    const headerHTML = '<tr>' + headers.map(h => `<th>${processInlineMarkdown(h)}</th>`).join('') + '</tr>';

    const rowsHTML = dataRows.map(row => {
      const cells = row.split('|').map(c => c.trim()).filter(c => c);
      return '<tr>' + cells.map(cell => `<td>${processInlineMarkdown(cell)}</td>`).join('') + '</tr>';
    }).join('\n');

    return `<table>\n${headerHTML}\n${rowsHTML}\n</table>`;
  });

  // Convert headers
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');

  // Convert lists (unordered)
  html = html.replace(/^(\*|\-|\+) (.+)$/gim, '<li>$2</li>');
  
  // Convert numbered lists
  html = html.replace(/^(\d+)\. (.+)$/gim, '<li>$2</li>');

  // Wrap consecutive list items
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    return '<ul>' + match + '</ul>';
  });

  // Process inline markdown in remaining text (bold, italic, links)
  html = html.split('\n').map(line => {
    // Skip lines that are already HTML tags
    if (line.match(/^<\/?(h[1-6]|ul|ol|li|table|tr|th|td|pre|code|div|p)/)) {
      return line;
    }
    // Skip empty lines
    if (!line.trim()) {
      return line;
    }
    // Process inline markdown and wrap in paragraph
    const processed = processInlineMarkdown(line);
    return `<p>${processed}</p>`;
  }).join('\n');

  // Add diagram placeholders (check if diagram file exists)
  // Map display names to file names
  const diagramMap = {
    'Revenue & Token Flow': 'revenue-flow',
    'Perpetual Pumping Flywheel': 'innovation-flywheel',
    'Innovation Flywheel': 'innovation-flywheel'
  };
  
  html = html.replace(/\[DIAGRAM: (.*?)\]/g, (match, displayName) => {
    // Get file name from map, or generate from display name
    const fileName = diagramMap[displayName] || displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    // Try SVG first, then PNG
    const svgPath = path.join(__dirname, 'diagrams', `${fileName}.svg`);
    const pngPath = path.join(__dirname, 'diagrams', `${fileName}.png`);
    const svgExists = fs.existsSync(svgPath);
    const pngExists = fs.existsSync(pngPath);
    
    if (svgExists) {
      // Read SVG and embed directly (better for PDF)
      const svgContent = fs.readFileSync(svgPath, 'utf-8');
      // Extract just the SVG content (remove XML declaration if present)
      const svgBody = svgContent.replace(/<\?xml[^>]*\?>\s*/i, '');
      return `<div class="diagram-container"><div class="diagram-title">${displayName}</div><div style="width: 100%; display: flex; justify-content: center;">${svgBody}</div></div>`;
    } else if (pngExists) {
      // Use absolute path for Puppeteer
      const absolutePath = path.resolve(pngPath);
      return `<div class="diagram-container"><div class="diagram-title">${displayName}</div><img src="file:///${absolutePath.replace(/\\/g, '/')}" alt="${displayName}" style="width: 100%; max-width: 100%; height: auto;" /></div>`;
    } else {
      return `<div class="diagram-container"><div class="diagram-title">${displayName}</div><div class="diagram-placeholder">[Diagram: ${displayName} - Run 'npm run whitepaper:diagrams' to generate]</div></div>`;
    }
  });

  // Add screenshot placeholders
  html = html.replace(/\[SCREENSHOT: (.*?)\]/g, (match, label) => {
    return `<div class="screenshot-placeholder"><div class="screenshot-label">${label}</div></div>`;
  });

  // Build full HTML document
  const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XFUEL: The Perpetual Yield Pumping Station - Whitepaper v1.0</title>
  <style>${styles}</style>
</head>
<body>
  <div class="cover-page">
    <div class="logo-placeholder">XFUEL</div>
    <h1>XFUEL</h1>
    <div class="cover-subtitle">The Perpetual Yield Pumping Station</div>
    <div class="cover-date">Whitepaper v1.0 — December 18, 2025</div>
  </div>
  <div class="page-break"></div>
  <div class="content">
    ${html}
  </div>
  <div class="footer">
    <p>XFUEL Protocol - The Perpetual Yield Pumping Station</p>
    <p>Whitepaper v1.0 | December 18, 2025</p>
  </div>
</body>
</html>`;

  return fullHTML;
}

function processInlineMarkdown(text) {
  // Convert bold
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.*?)__/g, '<strong>$1</strong>');
  
  // Convert italic
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
  text = text.replace(/_(.*?)_/g, '<em>$1</em>');
  
  // Convert links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: var(--neon-cyan);">$1</a>');
  
  return text;
}

function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Run if called directly
const isMainModule = process.argv[1] && (
  process.argv[1].includes('generate-pdf.mjs') ||
  import.meta.url.replace('file:///', '').replace(/\\/g, '/').endsWith(process.argv[1].replace(/\\/g, '/'))
);

if (isMainModule) {
  generatePDF().catch(console.error);
}

export { generatePDF, convertMarkdownToHTML };

