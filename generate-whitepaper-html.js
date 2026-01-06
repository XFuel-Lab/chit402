const fs = require('fs');
const path = require('path');

// Read the markdown file
const markdownPath = path.join(__dirname, 'docs', 'WHITEPAPER.md');
const markdown = fs.readFileSync(markdownPath, 'utf-8');

// Simple but effective markdown to HTML converter
function convertMarkdownToHTML(md) {
    let html = md;
    
    // Convert headers (must be done in order: h4 -> h3 -> h2 -> h1)
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Convert bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert italic
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Convert inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Convert code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, function(match, lang, code) {
        return '<pre><code>' + code.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>';
    });
    
    // Convert links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    
    // Convert horizontal rules
    html = html.replace(/^---$/gim, '<hr>');
    
    // Convert unordered lists (must handle nested)
    const lines = html.split('\n');
    let inList = false;
    let listLevel = 0;
    const processedLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const match = line.match(/^(\s*)-\s+(.*)$/);
        
        if (match) {
            const indent = match[1].length;
            const content = match[2];
            const level = Math.floor(indent / 2);
            
            if (!inList) {
                processedLines.push('<ul>');
                inList = true;
                listLevel = level;
            } else if (level > listLevel) {
                processedLines.push('<ul>');
                listLevel = level;
            } else if (level < listLevel) {
                processedLines.push('</ul>');
                listLevel = level;
            }
            
            processedLines.push(`<li>${content}</li>`);
        } else {
            if (inList) {
                while (listLevel >= 0) {
                    processedLines.push('</ul>');
                    listLevel--;
                }
                inList = false;
            }
            processedLines.push(line);
        }
    }
    
    if (inList) {
        while (listLevel >= 0) {
            processedLines.push('</ul>');
            listLevel--;
        }
    }
    
    html = processedLines.join('\n');
    
    // Convert ordered lists
    html = html.replace(/^\d+\.\s+(.*)$/gim, '<li>$1</li>');
    
    // Wrap consecutive <li> in <ol>
    html = html.replace(/(<li>.*<\/li>\n?)+/g, function(match) {
        return '<ol>' + match + '</ol>';
    });
    
    // Convert blockquotes
    html = html.replace(/^> (.*)$/gim, '<blockquote>$1</blockquote>');
    
    // Convert tables
    html = html.replace(/\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/g, function(match, header, rows) {
        const headers = header.split('|').filter(h => h.trim()).map(h => `<th>${h.trim()}</th>`).join('');
        const rowsHTML = rows.trim().split('\n').map(row => {
            const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('\n');
        return `<table>\n<thead><tr>${headers}</tr></thead>\n<tbody>\n${rowsHTML}\n</tbody>\n</table>`;
    });
    
    // Convert paragraphs (lines that aren't HTML tags)
    const finalLines = html.split('\n');
    const withParagraphs = [];
    let inParagraph = false;
    
    for (let line of finalLines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('<') && !trimmed.startsWith('<code>') && !trimmed.startsWith('<em>') && !trimmed.startsWith('<strong>')) {
            if (inParagraph) {
                withParagraphs.push('</p>');
                inParagraph = false;
            }
            withParagraphs.push(line);
        } else if (!trimmed.startsWith('<')) {
            if (!inParagraph) {
                withParagraphs.push('<p>');
                inParagraph = true;
            }
            withParagraphs.push(line);
        } else {
            if (inParagraph) {
                withParagraphs.push('</p>');
                inParagraph = false;
            }
            withParagraphs.push(line);
        }
    }
    
    return withParagraphs.join('\n');
}

const htmlContent = convertMarkdownToHTML(markdown);

// Create full HTML document
const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XFuel Protocol Whitepaper v3.1</title>
    <style>
        @page { size: A4; margin: 2cm; }
        * { box-sizing: border-box; max-width: 100%; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 21cm; margin: 0 auto; padding: 20px; background: white; }
        h1 { color: #1a1a1a; font-size: 32px; margin-top: 40px; margin-bottom: 20px; page-break-after: avoid; }
        h2 { color: #2c3e50; font-size: 24px; margin-top: 30px; margin-bottom: 15px; page-break-after: avoid; border-bottom: 2px solid #3498db; padding-bottom: 8px; }
        h3 { color: #34495e; font-size: 20px; margin-top: 25px; margin-bottom: 12px; page-break-after: avoid; }
        h4 { color: #7f8c8d; font-size: 16px; margin-top: 20px; margin-bottom: 10px; page-break-after: avoid; }
        p { margin: 12px 0; text-align: justify; }
        ul, ol { margin: 15px 0; padding-left: 30px; }
        li { margin: 8px 0; }
        code { background: #f8f9fa; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; font-size: 90%; color: #e83e8c; }
        pre { background: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #3498db; overflow-x: auto; page-break-inside: avoid; margin: 20px 0; }
        pre code { background: none; padding: 0; color: #333; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; page-break-inside: avoid; font-size: 14px; }
        th { background: #3498db; color: white; padding: 12px; text-align: left; font-weight: 600; }
        td { padding: 10px 12px; border: 1px solid #ddd; }
        tr:nth-child(even) { background: #f8f9fa; }
        blockquote { border-left: 4px solid #3498db; margin: 20px 0; padding: 10px 20px; background: #f8f9fa; font-style: italic; page-break-inside: avoid; }
        hr { border: none; border-top: 2px solid #ecf0f1; margin: 30px 0; }
        a { color: #3498db; text-decoration: none; }
        a:hover { text-decoration: underline; }
        strong { font-weight: 600; color: #2c3e50; }
        em { font-style: italic; color: #7f8c8d; }
        @media print { body { padding: 0; } a { color: #333; text-decoration: none; } }
    </style>
</head>
<body>
${htmlContent}
</body>
</html>`;

// Write to file
const outputPath = path.join(__dirname, 'docs', 'WHITEPAPER.html');
fs.writeFileSync(outputPath, fullHTML, 'utf-8');

console.log('✅ HTML whitepaper generated successfully!');
console.log('📄 Location: docs/WHITEPAPER.html');
console.log('\n🖨️  To convert to PDF:');
console.log('   1. Open docs/WHITEPAPER.html in your browser');
console.log('   2. Press Ctrl+P (or Cmd+P on Mac)');
console.log('   3. Select "Save as PDF"');
console.log('   4. Click "Save"');
console.log('\n✅ Done!');

