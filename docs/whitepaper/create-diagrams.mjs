import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';

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

async function createRevenueFlowDiagram() {
  console.log('📊 Creating Revenue & Token Flow Diagram...');

  const width = 1200;
  const height = 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = colors.darkBg;
  ctx.fillRect(0, 0, width, height);

  // Grid pattern
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Title
  ctx.font = 'bold 36px Orbitron, sans-serif';
  ctx.fillStyle = colors.neonPink;
  ctx.textAlign = 'center';
  ctx.shadowBlur = 20;
  ctx.shadowColor = colors.neonPink;
  ctx.fillText('Revenue & Token Flow', width / 2, 50);

  // Revenue source (left)
  const revenueX = 100;
  const revenueY = height / 2;
  drawGlassBox(ctx, revenueX - 100, revenueY - 60, 200, 120, 'Revenue', colors.neonCyan);

  // Split point (center)
  const splitX = width / 2;
  const splitY = height / 2;

  // 90% split (top paths)
  const topY = 200;
  const veXF_X = 400;
  const rXF_X = 600;
  const burn_X = 800;

  // Draw flow lines with glow
  drawFlowLine(ctx, revenueX + 100, revenueY, splitX - 150, splitY, colors.neonCyan);
  drawFlowLine(ctx, splitX - 100, splitY - 50, veXF_X, topY, colors.neonPink, '90%');
  drawFlowLine(ctx, splitX - 50, splitY - 50, rXF_X, topY, colors.neonGreen, '');
  drawFlowLine(ctx, splitX, splitY - 50, burn_X, topY, colors.neonPurple, '');

  // 10% to Treasury (bottom)
  const treasuryX = width / 2;
  const treasuryY = height - 150;
  drawFlowLine(ctx, splitX, splitY + 50, treasuryX, treasuryY - 60, colors.neonCyan, '10%');

  // Destination boxes
  drawGlassBox(ctx, veXF_X - 100, topY - 60, 200, 120, 'veXF', colors.neonPink);
  drawGlassBox(ctx, rXF_X - 100, topY - 60, 200, 120, 'rXF', colors.neonGreen);
  drawGlassBox(ctx, burn_X - 100, topY - 60, 200, 120, 'Burn', colors.neonPurple);
  drawGlassBox(ctx, treasuryX - 100, treasuryY - 60, 200, 120, 'Treasury', colors.neonCyan);

  // Save
  const buffer = canvas.toBuffer('image/png');
  const outputPath = path.join(__dirname, 'diagrams', 'revenue-flow.png');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  console.log('✅ Saved:', outputPath);
}

async function createInnovationFlywheel() {
  console.log('🔄 Creating Innovation Flywheel Diagram...');

  const width = 1000;
  const height = 1000;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = colors.darkBg;
  ctx.fillRect(0, 0, width, height);

  // Grid
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Title
  ctx.font = 'bold 36px Orbitron, sans-serif';
  ctx.fillStyle = colors.neonGreen;
  ctx.textAlign = 'center';
  ctx.shadowBlur = 20;
  ctx.shadowColor = colors.neonGreen;
  ctx.fillText('Innovation Flywheel', width / 2, 50);

  // Circular layout
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 300;

  const nodes = [
    { angle: 0, label: 'Revenue', color: colors.neonCyan },
    { angle: Math.PI / 2, label: 'Treasury', color: colors.neonPink },
    { angle: Math.PI, label: 'Vaults', color: colors.neonGreen },
    { angle: 3 * Math.PI / 2, label: 'Spin-outs', color: colors.neonPurple },
    { angle: Math.PI / 4, label: 'TVL Growth', color: colors.neonCyan }
  ];

  // Draw circular flow arrows
  ctx.strokeStyle = colors.neonCyan;
  ctx.lineWidth = 4;
  ctx.shadowBlur = 15;
  ctx.shadowColor = colors.neonCyan;
  
  for (let i = 0; i < nodes.length; i++) {
    const start = nodes[i];
    const end = nodes[(i + 1) % nodes.length];
    
    const startX = centerX + Math.cos(start.angle) * radius;
    const startY = centerY + Math.sin(start.angle) * radius;
    const endX = centerX + Math.cos(end.angle) * radius;
    const endY = centerY + Math.sin(end.angle) * radius;
    
    // Draw curved arrow
    drawCurvedArrow(ctx, startX, startY, endX, endY, start.angle, end.angle, centerX, centerY);
  }

  // Draw nodes
  nodes.forEach(node => {
    const x = centerX + Math.cos(node.angle) * radius;
    const y = centerY + Math.sin(node.angle) * radius;
    drawGlassBox(ctx, x - 80, y - 40, 160, 80, node.label, node.color);
  });

  // Save
  const buffer = canvas.toBuffer('image/png');
  const outputPath = path.join(__dirname, 'diagrams', 'innovation-flywheel.png');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  console.log('✅ Saved:', outputPath);
}

function drawGlassBox(ctx, x, y, w, h, text, color) {
  // Glass effect background
  ctx.fillStyle = colors.glassBg;
  ctx.fillRect(x, y, w, h);
  
  // Border with glow
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowBlur = 20;
  ctx.shadowColor = color;
  ctx.strokeRect(x, y, w, h);
  
  // Text
  ctx.font = 'bold 20px Orbitron, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = 15;
  ctx.shadowColor = color;
  ctx.fillText(text, x + w / 2, y + h / 2);
  
  ctx.shadowBlur = 0;
}

function drawFlowLine(ctx, x1, y1, x2, y2, color, label = '') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.shadowBlur = 15;
  ctx.shadowColor = color;
  
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  
  // Arrow head
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const arrowLength = 15;
  const arrowAngle = Math.PI / 6;
  
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - arrowLength * Math.cos(angle - arrowAngle),
    y2 - arrowLength * Math.sin(angle - arrowAngle)
  );
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - arrowLength * Math.cos(angle + arrowAngle),
    y2 - arrowLength * Math.sin(angle + arrowAngle)
  );
  ctx.stroke();
  
  // Label
  if (label) {
    ctx.font = '16px Orbitron, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label, (x1 + x2) / 2, (y1 + y2) / 2 - 10);
  }
  
  ctx.shadowBlur = 0;
}

function drawCurvedArrow(ctx, x1, y1, x2, y2, angle1, angle2, centerX, centerY) {
  const radius = Math.sqrt(Math.pow(x1 - centerX, 2) + Math.pow(y1 - centerY, 2));
  
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, angle1, angle2, false);
  ctx.stroke();
  
  // Arrow head at end
  const arrowX = x2;
  const arrowY = y2;
  const angle = angle2;
  const arrowLength = 20;
  const arrowAngle = Math.PI / 6;
  
  ctx.beginPath();
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(
    arrowX - arrowLength * Math.cos(angle - arrowAngle),
    arrowY - arrowLength * Math.sin(angle - arrowAngle)
  );
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(
    arrowX - arrowLength * Math.cos(angle + arrowAngle),
    arrowY - arrowLength * Math.sin(angle + arrowAngle)
  );
  ctx.stroke();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await createRevenueFlowDiagram();
    await createInnovationFlywheel();
    console.log('\n✅ All diagrams created!');
  })().catch(console.error);
}

export { createRevenueFlowDiagram, createInnovationFlywheel };

