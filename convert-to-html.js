const fs = require('fs');
const path = require('path');

// Read the markdown
const markdown = fs.readFileSync('docs/WHITEPAPER.md', 'utf8');

// Simple markdown to HTML converter
function markdownToHtml(md) {
    let html = md;
    
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 id="$1">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 id="$1">$1</h1>');
    
    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Links
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    
    // Code blocks
    html = html.replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    
    // Tables (basic)
    const tableRegex = /\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/g;
    html = html.replace(tableRegex, (match) => {
        const lines = match.trim().split('\n');
        const headers = lines[0].split('|').filter(h => h.trim());
        const rows = lines.slice(2).map(line => 
            line.split('|').filter(c => c.trim())
        );
        
        let table = '<table>\n<thead><tr>';
        headers.forEach(h => table += `<th>${h.trim()}</th>`);
        table += '</tr></thead>\n<tbody>';
        rows.forEach(row => {
            table += '<tr>';
            row.forEach(cell => table += `<td>${cell.trim()}</td>`);
            table += '</tr>\n';
        });
        table += '</tbody></table>';
        return table;
    });
    
    // Paragraphs
    html = html.split('\n\n').map(p => {
        if (!p.trim()) return '';
        if (p.startsWith('<')) return p;
        if (p.includes('<li>')) return '<ul>' + p + '</ul>';
        return '<p>' + p + '</p>';
    }).join('\n');
    
    return html;
}

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XFuel Protocol - Whitepaper v3.1</title>
    <style>
        @page {
            size: letter;
            margin: 1in;
        }
        
        body {
            font-family: 'Georgia', 'Times New Roman', serif;
            line-height: 1.6;
            color: #333;
            max-width: 8.5in;
            margin: 0 auto;
            padding: 20px;
            font-size: 11pt;
        }
        
        .cover-page {
            text-align: center;
            padding: 150px 0;
            page-break-after: always;
        }
        
        .cover-page h1 {
            font-size: 42pt;
            margin: 20px 0;
            color: #c00;
        }
        
        .cover-page .emoji {
            font-size: 72pt;
            margin: 40px 0;
        }
        
        .cover-page .subtitle {
            font-size: 24pt;
            color: #666;
            margin: 20px 0;
        }
        
        h1 {
            color: #c00;
            font-size: 24pt;
            margin-top: 40px;
            page-break-before: always;
        }
        
        h2 {
            color: #333;
            font-size: 18pt;
            margin-top: 30px;
            border-bottom: 2px solid #c00;
            padding-bottom: 10px;
        }
        
        h3 {
            color: #666;
            font-size: 14pt;
            margin-top: 20px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            page-break-inside: avoid;
        }
        
        th, td {
            border: 1px solid #ddd;
            padding: 10px;
            text-align: left;
        }
        
        th {
            background-color: #c00;
            color: white;
            font-weight: bold;
        }
        
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        
        code {
            background-color: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 10pt;
        }
        
        pre {
            background-color: #f4f4f4;
            padding: 15px;
            border-left: 4px solid #c00;
            overflow-x: auto;
            page-break-inside: avoid;
        }
        
        pre code {
            background: none;
            padding: 0;
        }
        
        a {
            color: #0066cc;
            text-decoration: none;
        }
        
        ul, ol {
            margin: 10px 0;
            padding-left: 30px;
        }
        
        li {
            margin: 5px 0;
        }
        
        blockquote {
            border-left: 4px solid #c00;
            padding-left: 20px;
            margin: 20px 0;
            font-style: italic;
            color: #666;
        }
        
        .no-print {
            background: #ffffcc;
            padding: 20px;
            margin: 20px 0;
            border: 2px solid #c00;
        }
        
        @media print {
            .no-print {
                display: none;
            }
        }
    </style>
</head>
<body>
    <div class="cover-page">
        <div class="emoji">🏎️ ⚡ 🚀</div>
        <h1>XFuel Protocol</h1>
        <div class="subtitle">Ferrari Hybrid Tokenomics Edition</div>
        <div style="font-size: 18pt; margin: 20px 0;">
            <strong>Version 3.1</strong><br>
            ZK Bridge + Persistence LP Focus
        </div>
        <div style="font-size: 14pt; margin: 60px 0;">
            <p><strong>XFuel Lab</strong></p>
            <p>January 5, 2026</p>
            <p style="margin-top: 40px;"><strong>Status:</strong> Production Ready - Awaiting CertiK Audit</p>
            <p><em>Sub-4s Settlements | Zero-Knowledge Security | Sustainable Tokenomics</em></p>
        </div>
    </div>

    <div class="no-print">
        <h3 style="margin-top: 0;">📄 To Generate PDF:</h3>
        <ol>
            <li>Press <strong>Ctrl+P</strong> (or Cmd+P on Mac)</li>
            <li>Select <strong>"Save as PDF"</strong></li>
            <li>Check <strong>"Background graphics"</strong></li>
            <li>Save as <code>WHITEPAPER.pdf</code></li>
        </ol>
    </div>

${markdownToHtml(markdown)}

    <div style="margin-top: 80px; padding: 40px 0; border-top: 2px solid #c00; text-align: center;">
        <p><strong>XFuel Protocol Whitepaper v3.1</strong></p>
        <p>© 2026 XFuel Protocol. MIT License.</p>
    </div>
</body>
</html>`;

fs.writeFileSync('docs/WHITEPAPER_FULL.html', htmlContent);
console.log('✅ Complete HTML generated: docs/WHITEPAPER_FULL.html');
console.log('Open in browser and press Ctrl+P to generate PDF');


