import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateMediumMarkdown() {
  console.log('📝 Generating Medium Markdown version...\n');

  const contentPath = path.join(__dirname, 'whitepaper-content.md');
  let content = fs.readFileSync(contentPath, 'utf-8');

  // Clean up for Medium
  // Remove HTML comments
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  // Convert diagram placeholders to Medium-friendly format
  const diagramMap = {
    'Revenue & Token Flow': 'revenue-flow',
    'Perpetual Pumping Flywheel': 'innovation-flywheel',
    'Innovation Flywheel': 'innovation-flywheel'
  };
  
  content = content.replace(/\[DIAGRAM: (.*?)\]/g, (match, displayName) => {
    const fileName = diagramMap[displayName] || displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const diagramPath = path.join(__dirname, 'diagrams', `${fileName}.png`);
    const diagramExists = fs.existsSync(diagramPath);
    
    if (diagramExists) {
      // Medium supports image uploads - use relative path or note for manual upload
      return `\n\n![${displayName}](diagrams/${fileName}.png)\n\n*${displayName}*\n\n`;
    } else {
      return `\n\n> **${displayName}**\n> \n> [Diagram placeholder - upload diagram image here]\n\n`;
    }
  });

  // Convert screenshot placeholders
  content = content.replace(/\[SCREENSHOT: (.*?)\]/g, (match, label) => {
    return `\n\n![${label}](screenshot-placeholder.png)\n\n*${label}*\n\n`;
  });

  // Add Medium header
  const mediumHeader = `---
title: XFUEL: The Perpetual Yield Pumping Station
subtitle: Whitepaper v1.0 — December 18, 2025
tags: [crypto, defi, yield, xfuel, blockchain]
---

`;

  const fullContent = mediumHeader + content;

  const outputPath = path.join(__dirname, 'XFUEL-Whitepaper-Medium.md');
  fs.writeFileSync(outputPath, fullContent);

  console.log('✅ Medium Markdown generated:', outputPath);
  console.log('\n📄 Medium version ready for publication!');
}

// Run if called directly (check if this file is being executed)
const fileUrl = import.meta.url;
const scriptPath = process.argv[1]?.replace(/\\/g, '/');
const currentFile = fileUrl.replace('file:///', '').replace(/\\/g, '/');

if (!scriptPath || currentFile.endsWith(scriptPath) || scriptPath.includes('generate-medium.mjs')) {
  generateMediumMarkdown();
}

export { generateMediumMarkdown };

