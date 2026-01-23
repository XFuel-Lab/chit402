const fs = require('fs');
const { marked } = require('marked');

// Read the markdown
const markdown = fs.readFileSync('docs/WHITEPAPER.md', 'utf8');

// Configure marked for better output
marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: true,
    mangle: false
});

// Convert markdown to HTML
const contentHtml = marked(markdown);

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XFuel Protocol - Whitepaper v3.1</title>
    <style>
        @page {
            size: letter;
            margin: 0.75in;
        }
        
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Georgia', 'Times New Roman', serif;
            line-height: 1.7;
            color: #2c3e50;
            max-width: 8.5in;
            margin: 0 auto;
            padding: 30px;
            font-size: 11pt;
            background: white;
        }
        
        .cover-page {
            text-align: center;
            padding: 150px 20px;
            page-break-after: always;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        
        .cover-page h1 {
            font-size: 48pt;
            margin: 30px 0;
            color: #DC0714;
            font-weight: 900;
            letter-spacing: -1px;
        }
        
        .cover-page .emoji {
            font-size: 80pt;
            margin: 40px 0;
            line-height: 1;
        }
        
        .cover-page .subtitle {
            font-size: 24pt;
            color: #555;
            margin: 30px 0;
            font-weight: 300;
        }
        
        .cover-page .version {
            font-size: 20pt;
            margin: 30px 0;
            font-weight: 600;
        }
        
        .cover-page .meta {
            font-size: 14pt;
            margin: 60px 0 20px 0;
            color: #666;
        }
        
        h1 {
            color: #DC0714;
            font-size: 28pt;
            margin: 50px 0 20px 0;
            page-break-before: always;
            font-weight: 700;
            border-bottom: 3px solid #DC0714;
            padding-bottom: 10px;
        }
        
        h1:first-of-type {
            page-break-before: auto;
        }
        
        h2 {
            color: #2c3e50;
            font-size: 20pt;
            margin: 35px 0 15px 0;
            font-weight: 600;
            border-bottom: 2px solid #DC0714;
            padding-bottom: 8px;
        }
        
        h3 {
            color: #34495e;
            font-size: 15pt;
            margin: 25px 0 12px 0;
            font-weight: 600;
        }
        
        h4 {
            color: #555;
            font-size: 13pt;
            margin: 20px 0 10px 0;
            font-weight: 600;
        }
        
        p {
            margin: 12px 0;
            text-align: justify;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 25px 0;
            page-break-inside: avoid;
            font-size: 10pt;
        }
        
        th, td {
            border: 1px solid #bdc3c7;
            padding: 12px;
            text-align: left;
            vertical-align: top;
        }
        
        th {
            background-color: #DC0714;
            color: white;
            font-weight: 600;
            text-align: center;
        }
        
        tr:nth-child(even) {
            background-color: #f8f9fa;
        }
        
        tr:hover {
            background-color: #ffe6e8;
        }
        
        code {
            background-color: #f4f4f4;
            padding: 3px 7px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 9.5pt;
            color: #c7254e;
            border: 1px solid #e1e1e1;
        }
        
        pre {
            background-color: #2c3e50;
            color: #ecf0f1;
            padding: 20px;
            border-left: 5px solid #DC0714;
            overflow-x: auto;
            page-break-inside: avoid;
            border-radius: 5px;
            margin: 20px 0;
        }
        
        pre code {
            background: none;
            padding: 0;
            border: none;
            color: #ecf0f1;
            font-size: 9pt;
        }
        
        a {
            color: #0066cc;
            text-decoration: none;
            font-weight: 500;
        }
        
        a:hover {
            text-decoration: underline;
        }
        
        ul, ol {
            margin: 15px 0;
            padding-left: 35px;
        }
        
        li {
            margin: 8px 0;
        }
        
        li > ul, li > ol {
            margin: 5px 0;
        }
        
        blockquote {
            border-left: 5px solid #DC0714;
            padding: 15px 25px;
            margin: 25px 0;
            background-color: #fff5f5;
            font-style: italic;
            color: #555;
            page-break-inside: avoid;
        }
        
        blockquote p {
            margin: 5px 0;
        }
        
        strong {
            color: #2c3e50;
            font-weight: 700;
        }
        
        em {
            color: #555;
        }
        
        hr {
            border: none;
            border-top: 2px solid #DC0714;
            margin: 40px 0;
        }
        
        .no-print {
            background: linear-gradient(135deg, #ffe6e8 0%, #fff5f5 100%);
            padding: 25px;
            margin: 30px 0;
            border: 3px solid #DC0714;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        
        .no-print h3 {
            color: #DC0714;
            margin-top: 0;
            font-size: 16pt;
        }
        
        .no-print ol {
            font-size: 12pt;
            line-height: 1.8;
        }
        
        .no-print code {
            background: white;
            border: 1px solid #DC0714;
        }
        
        .footer {
            margin-top: 80px;
            padding: 40px 0;
            border-top: 3px solid #DC0714;
            text-align: center;
            color: #666;
            page-break-before: always;
        }
        
        .footer p {
            margin: 10px 0;
            text-align: center;
        }
        
        @media print {
            .no-print {
                display: none !important;
            }
            
            body {
                padding: 0;
            }
            
            a {
                color: #0066cc;
                text-decoration: none;
            }
            
            pre {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="cover-page">
        <div class="emoji">🏎️ ⚡ 🚀</div>
        <h1>XFuel Protocol</h1>
        <div class="subtitle">Ferrari Hybrid Tokenomics Edition</div>
        <div class="version">
            <strong>Version 3.1</strong><br>
            <span style="font-size: 16pt; color: #DC0714;">ZK Bridge + Persistence LP Focus</span>
        </div>
        <div class="meta">
            <p><strong style="font-size: 16pt;">XFuel Lab</strong></p>
            <p style="font-size: 14pt; margin: 20px 0;">January 5, 2026</p>
            <p style="margin-top: 50px; font-size: 13pt;"><strong>Status:</strong> Production Ready - Awaiting CertiK Audit</p>
            <p style="margin-top: 20px; font-style: italic; color: #DC0714;">
                Sub-4s Settlements | Zero-Knowledge Security | Sustainable Tokenomics
            </p>
        </div>
    </div>

    <div class="no-print">
        <h3>📄 How to Generate PDF from this HTML:</h3>
        <ol>
            <li>Press <strong>Ctrl+P</strong> (Windows/Linux) or <strong>Cmd+P</strong> (Mac)</li>
            <li>Select <strong>"Save as PDF"</strong> as the destination</li>
            <li>✅ Check <strong>"Background graphics"</strong> option</li>
            <li>Set margins to <strong>"Default"</strong> or <strong>"Minimum"</strong></li>
            <li>Click <strong>"Save"</strong> and name it <code>WHITEPAPER.pdf</code></li>
        </ol>
        <p style="margin-top: 20px; font-weight: 600; color: #DC0714;">
            ⚠️ Make sure "Background graphics" is enabled to see the red styling!
        </p>
    </div>

    <article>
${contentHtml}
    </article>

    <div class="footer">
        <p style="font-size: 14pt; font-weight: 600;">XFuel Protocol Whitepaper v3.1</p>
        <p style="font-size: 11pt;">ZK Bridge + Persistence LP Focus Edition</p>
        <p style="font-size: 10pt; margin-top: 20px;">© 2026 XFuel Protocol. MIT License.</p>
        <p style="font-size: 10pt; color: #999;">Generated from canonical source: github.com/XFuel-Lab/xfuel-protocol</p>
    </div>
</body>
</html>`;

fs.writeFileSync('docs/WHITEPAPER_COMPLETE.html', htmlContent);
console.log('✅ COMPLETE whitepaper HTML generated: docs/WHITEPAPER_COMPLETE.html');
console.log('📏 File size:', (htmlContent.length / 1024).toFixed(1), 'KB');
console.log('');
console.log('🚀 Next steps:');
console.log('   1. Open docs/WHITEPAPER_COMPLETE.html in your browser');
console.log('   2. Press Ctrl+P (or Cmd+P)');
console.log('   3. Enable "Background graphics"');
console.log('   4. Save as PDF');


