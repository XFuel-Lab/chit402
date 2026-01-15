import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_IMAGE = process.argv[2] || path.join(__dirname, '../edgefarm-mobile/assets/Favorite LOGO Xpump.jpg');
const OUTPUT_DIR = path.join(__dirname, '../public');

async function extractLogoSimple() {
  try {
    if (!fs.existsSync(SOURCE_IMAGE)) {
      console.error(`❌ Source image not found: ${SOURCE_IMAGE}`);
      process.exit(1);
    }

    console.log('🎨 Simple logo extraction (aggressive background removal)...\n');

    const metadata = await sharp(SOURCE_IMAGE).metadata();
    const imgWidth = metadata.width!;
    const imgHeight = metadata.height!;

    // Crop center 80% - tighter crop to focus on logo
    const cropSize = Math.min(
      Math.floor(imgWidth * 0.8),
      Math.floor(imgHeight * 0.8)
    );
    const left = Math.floor((imgWidth - cropSize) / 2);
    const top = Math.floor((imgHeight - cropSize) / 2);

    console.log(`✂️  Cropping: ${cropSize}x${cropSize} at (${left}, ${top})`);

    // Extract and enhance
    const { data, info } = await sharp(SOURCE_IMAGE)
      .extract({ left, top, width: cropSize, height: cropSize })
      .resize(2048, 2048, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .modulate({ brightness: 1.5, saturation: 1.4 })
      .normalize()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const processed = Buffer.allocUnsafe(data.length);
    
    // Very aggressive: only keep bright purple/glowing pixels
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      
      // Keep only if:
      // 1. Very bright (glow)
      // 2. Purple color (high R+B, low G)
      // 3. Or bright enough overall
      const isPurple = (r > 60 && b > 60 && (r + b) > g * 1.3) || (r > 100 && b > 100);
      const isBright = brightness > 40;
      
      if (isPurple || isBright) {
        // Keep and enhance
        processed[i] = Math.min(255, r * 1.2);
        processed[i + 1] = Math.min(255, g * 0.8);
        processed[i + 2] = Math.min(255, b * 1.25);
        // Alpha based on how bright/purple it is
        const alpha = isPurple ? 255 : Math.min(255, Math.max(150, brightness * 2));
        processed[i + 3] = alpha;
      } else {
        // Transparent
        processed[i] = 0;
        processed[i + 1] = 0;
        processed[i + 2] = 0;
        processed[i + 3] = 0;
      }
    }

    const final = await sharp(processed, {
      raw: { width: info.width, height: info.height, channels: 4 }
    }).png().toBuffer();

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Save final logo
    await sharp(final)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'logo.png'));

    console.log('✅ Done! Check public/logo.png');
    console.log('💡 If still not good, try manually editing the image or adjust thresholds in the script.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

extractLogoSimple();

