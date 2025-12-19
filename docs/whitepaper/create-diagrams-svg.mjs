import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Neon color palette
const colors = {
  neonPink: '#ff00ff',
  neonCyan: '#00ffff',
  neonGreen: '#00ff41',
  neonPurple: '#b026ff',
  darkBg: '#0a0a0a',
  glassBg: 'rgba(255, 255, 255, 0.03)'
};

function createRevenueFlowDiagram() {
  console.log('📊 Creating Revenue & Token Flow Diagram (SVG)...');

  const width = 1200;
  const height = 800;

  // Create SVG with cyberpunk styling
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Grid pattern -->
    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="${colors.neonCyan}" stroke-width="1" opacity="0.1"/>
    </pattern>
    
    <!-- Neon glow filters -->
    <filter id="neon-pink">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <filter id="neon-cyan">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <filter id="neon-green">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <filter id="neon-purple">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <!-- Arrow markers -->
    <marker id="arrow-pink" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="${colors.neonPink}"/>
    </marker>
    <marker id="arrow-cyan" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="${colors.neonCyan}"/>
    </marker>
    <marker id="arrow-green" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="${colors.neonGreen}"/>
    </marker>
    <marker id="arrow-purple" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="${colors.neonPurple}"/>
    </marker>
  </defs>
  
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="${colors.darkBg}"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  
  <!-- Title -->
  <text x="${width/2}" y="50" font-family="Orbitron, sans-serif" font-size="36" font-weight="bold" 
        fill="${colors.neonPink}" text-anchor="middle" filter="url(#neon-pink)">
    Revenue &amp; Token Flow
  </text>
  
  <!-- Revenue source (left) -->
  <g id="revenue-box">
    <rect x="0" y="${height/2 - 60}" width="200" height="120" rx="12" 
          fill="${colors.glassBg}" stroke="${colors.neonCyan}" stroke-width="3" 
          filter="url(#neon-cyan)" opacity="0.9"/>
    <text x="100" y="${height/2 - 10}" font-family="Orbitron, sans-serif" font-size="20" font-weight="bold" 
          fill="${colors.neonCyan}" text-anchor="middle" filter="url(#neon-cyan)">Revenue</text>
  </g>
  
  <!-- Split point (center) -->
  <circle cx="${width/2}" cy="${height/2}" r="8" fill="${colors.neonCyan}" filter="url(#neon-cyan)"/>
  
  <!-- Flow lines to 90% split (top) -->
  <g id="flow-90">
    <!-- Main flow from revenue to split -->
    <line x1="200" y1="${height/2}" x2="${width/2 - 150}" y2="${height/2}" 
          stroke="${colors.neonCyan}" stroke-width="4" filter="url(#neon-cyan)" marker-end="url(#arrow-cyan)"/>
    
    <!-- Split to veXF -->
    <line x1="${width/2 - 100}" y1="${height/2 - 50}" x2="400" y2="200" 
          stroke="${colors.neonPink}" stroke-width="4" filter="url(#neon-pink)" marker-end="url(#arrow-pink)"/>
    <text x="${(width/2 - 100 + 400)/2}" y="${(height/2 - 50 + 200)/2 - 10}" 
          font-family="Orbitron, sans-serif" font-size="16" fill="${colors.neonPink}" 
          filter="url(#neon-pink)">50%</text>
    
    <!-- Split to rXF -->
    <line x1="${width/2 - 50}" y1="${height/2 - 50}" x2="600" y2="200" 
          stroke="${colors.neonGreen}" stroke-width="4" filter="url(#neon-green)" marker-end="url(#arrow-green)"/>
    <text x="${(width/2 - 50 + 600)/2}" y="${(height/2 - 50 + 200)/2 - 10}" 
          font-family="Orbitron, sans-serif" font-size="16" fill="${colors.neonGreen}" 
          filter="url(#neon-green)">15%</text>
    
    <!-- Split to Burn -->
    <line x1="${width/2}" y1="${height/2 - 50}" x2="800" y2="200" 
          stroke="${colors.neonPurple}" stroke-width="4" filter="url(#neon-purple)" marker-end="url(#arrow-purple)"/>
    <text x="${(width/2 + 800)/2}" y="${(height/2 - 50 + 200)/2 - 10}" 
          font-family="Orbitron, sans-serif" font-size="16" fill="${colors.neonPurple}" 
          filter="url(#neon-purple)">25%</text>
  </g>
  
  <!-- 10% to Treasury (bottom) -->
  <line x1="${width/2}" y1="${height/2 + 50}" x2="${width/2}" y2="${height - 150}" 
        stroke="${colors.neonCyan}" stroke-width="4" filter="url(#neon-cyan)" marker-end="url(#arrow-cyan)"/>
  <text x="${width/2 + 20}" y="${(height/2 + 50 + height - 150)/2}" 
        font-family="Orbitron, sans-serif" font-size="16" fill="${colors.neonCyan}" 
        filter="url(#neon-cyan)">10%</text>
  
  <!-- Destination boxes -->
  <g id="veXF-box">
    <rect x="300" y="140" width="200" height="120" rx="12" 
          fill="${colors.glassBg}" stroke="${colors.neonPink}" stroke-width="3" 
          filter="url(#neon-pink)" opacity="0.9"/>
    <text x="400" y="200" font-family="Orbitron, sans-serif" font-size="20" font-weight="bold" 
          fill="${colors.neonPink}" text-anchor="middle" filter="url(#neon-pink)">veXF</text>
    <text x="400" y="230" font-family="Orbitron, sans-serif" font-size="14" 
          fill="${colors.neonPink}" text-anchor="middle" opacity="0.8">Yield</text>
  </g>
  
  <g id="rXF-box">
    <rect x="500" y="140" width="200" height="120" rx="12" 
          fill="${colors.glassBg}" stroke="${colors.neonGreen}" stroke-width="3" 
          filter="url(#neon-green)" opacity="0.9"/>
    <text x="600" y="200" font-family="Orbitron, sans-serif" font-size="20" font-weight="bold" 
          fill="${colors.neonGreen}" text-anchor="middle" filter="url(#neon-green)">rXF</text>
    <text x="600" y="230" font-family="Orbitron, sans-serif" font-size="14" 
          fill="${colors.neonGreen}" text-anchor="middle" opacity="0.8">Receipts</text>
  </g>
  
  <g id="burn-box">
    <rect x="700" y="140" width="200" height="120" rx="12" 
          fill="${colors.glassBg}" stroke="${colors.neonPurple}" stroke-width="3" 
          filter="url(#neon-purple)" opacity="0.9"/>
    <text x="800" y="200" font-family="Orbitron, sans-serif" font-size="20" font-weight="bold" 
          fill="${colors.neonPurple}" text-anchor="middle" filter="url(#neon-purple)">Burn</text>
    <text x="800" y="230" font-family="Orbitron, sans-serif" font-size="14" 
          fill="${colors.neonPurple}" text-anchor="middle" opacity="0.8">Deflation</text>
  </g>
  
  <g id="treasury-box">
    <rect x="${width/2 - 100}" y="${height - 210}" width="200" height="120" rx="12" 
          fill="${colors.glassBg}" stroke="${colors.neonCyan}" stroke-width="3" 
          filter="url(#neon-cyan)" opacity="0.9"/>
    <text x="${width/2}" y="${height - 150}" font-family="Orbitron, sans-serif" font-size="20" font-weight="bold" 
          fill="${colors.neonCyan}" text-anchor="middle" filter="url(#neon-cyan)">Treasury</text>
    <text x="${width/2}" y="${height - 120}" font-family="Orbitron, sans-serif" font-size="14" 
          fill="${colors.neonCyan}" text-anchor="middle" opacity="0.8">Innovation</text>
  </g>
  
  <!-- Arrow markers (moved to top defs section) -->
</svg>`;

  const outputPath = path.join(__dirname, 'diagrams', 'revenue-flow.svg');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, svg);
  console.log('✅ Saved:', outputPath);
  
  // Also create PNG version using a simple conversion (if possible)
  return outputPath;
}

function createInnovationFlywheel() {
  console.log('🔄 Creating Innovation Flywheel Diagram (SVG)...');

  const width = 1000;
  const height = 1000;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 300;

  const nodes = [
    { angle: 0, label: 'Revenue', color: colors.neonCyan, x: centerX + radius, y: centerY },
    { angle: Math.PI / 2, label: 'Treasury', color: colors.neonPink, x: centerX, y: centerY - radius },
    { angle: Math.PI, label: 'Vaults', color: colors.neonGreen, x: centerX - radius, y: centerY },
    { angle: 3 * Math.PI / 2, label: 'Spin-outs', color: colors.neonPurple, x: centerX, y: centerY + radius },
    { angle: Math.PI / 4, label: 'TVL Growth', color: colors.neonCyan, 
      x: centerX + Math.cos(Math.PI / 4) * radius, y: centerY + Math.sin(Math.PI / 4) * radius }
  ];

  // Build SVG
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Grid pattern -->
    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="${colors.neonCyan}" stroke-width="1" opacity="0.1"/>
    </pattern>
    
    <!-- Neon glow filters -->
    <filter id="neon-pink">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <filter id="neon-cyan">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <filter id="neon-green">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <filter id="neon-purple">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <marker id="arrow-cyan" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="${colors.neonCyan}"/>
    </marker>
  </defs>
  
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="${colors.darkBg}"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  
  <!-- Title -->
  <text x="${centerX}" y="50" font-family="Orbitron, sans-serif" font-size="36" font-weight="bold" 
        fill="${colors.neonGreen}" text-anchor="middle" filter="url(#neon-green)">
    Innovation Flywheel
  </text>
  
  <!-- Circular flow arrows -->
`;

  // Draw circular arrows between nodes
  for (let i = 0; i < nodes.length; i++) {
    const start = nodes[i];
    const end = nodes[(i + 1) % nodes.length];
    
    // Calculate arc path
    const largeArc = Math.abs(end.angle - start.angle) > Math.PI ? 1 : 0;
    const sweep = 1; // clockwise
    
    const startX = centerX + Math.cos(start.angle) * radius;
    const startY = centerY + Math.sin(start.angle) * radius;
    const endX = centerX + Math.cos(end.angle) * radius;
    const endY = centerY + Math.sin(end.angle) * radius;
    
    svg += `  <path d="M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${endX} ${endY}" 
          fill="none" stroke="${start.color}" stroke-width="4" 
          filter="url(#neon-${start.color === colors.neonPink ? 'pink' : start.color === colors.neonCyan ? 'cyan' : start.color === colors.neonGreen ? 'green' : 'purple'})" 
          marker-end="url(#arrow-cyan)"/>\n`;
  }

  // Draw nodes
  nodes.forEach(node => {
    svg += `  <g id="${node.label.toLowerCase().replace(/\s+/g, '-')}-box">
    <rect x="${node.x - 80}" y="${node.y - 40}" width="160" height="80" rx="12" 
          fill="${colors.glassBg}" stroke="${node.color}" stroke-width="3" 
          filter="url(#neon-${node.color === colors.neonPink ? 'pink' : node.color === colors.neonCyan ? 'cyan' : node.color === colors.neonGreen ? 'green' : 'purple'})" 
          opacity="0.9"/>
    <text x="${node.x}" y="${node.y + 5}" font-family="Orbitron, sans-serif" font-size="18" font-weight="bold" 
          fill="${node.color}" text-anchor="middle" 
          filter="url(#neon-${node.color === colors.neonPink ? 'pink' : node.color === colors.neonCyan ? 'cyan' : node.color === colors.neonGreen ? 'green' : 'purple'})">${node.label}</text>
  </g>\n`;
  });

  svg += `</svg>`;

  const outputPath = path.join(__dirname, 'diagrams', 'innovation-flywheel.svg');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, svg);
  console.log('✅ Saved:', outputPath);
  
  return outputPath;
}

// Run if called directly
if (import.meta.url === `file://${path.resolve(process.argv[1])}` || 
    process.argv[1]?.includes('create-diagrams-svg.mjs')) {
  (async () => {
    await createRevenueFlowDiagram();
    await createInnovationFlywheel();
    console.log('\n✅ All SVG diagrams created!');
    console.log('💡 Note: SVG files can be converted to PNG using online tools or Inkscape');
  })().catch(console.error);
}

export { createRevenueFlowDiagram, createInnovationFlywheel };

