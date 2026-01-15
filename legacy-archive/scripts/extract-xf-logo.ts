import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the new image - update this path to your new image file
const SOURCE_IMAGE = process.argv[2] || path.join(__dirname, '../assets/xf-logo-new.png');
const OUTPUT_DIR = path.join(__dirname, '../public');

async function extractXFLogo() {
  try {
    // Check if source exists, if not, prompt user
    if (!fs.existsSync(SOURCE_IMAGE)) {
      console.error(`❌ Source image not found: ${SOURCE_IMAGE}`);
      console.log('\n📁 Please save your new logo image and run:');
      console.log('   npm run extract-xf-logo path/to/your/new-logo.png');
      console.log('\nOr save it as: assets/xf-logo-new.png');
      process.exit(1);
    }

    console.log('🎨 Extracting XF logo (purple glow + gas pump) from circuit board...\n');
    console.log(`📁 Source: ${SOURCE_IMAGE}`);

    const metadata = await sharp(SOURCE_IMAGE).metadata();
    console.log(`📐 Dimensions: ${metadata.width}x${metadata.height}`);

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image');
    }

    // Step 1: Enhance to make purple glow more visible
    const enhanced = await sharp(SOURCE_IMAGE)
      .modulate({
        brightness: 1.6,  // Brighten to see glow better
        saturation: 1.5  // Increase saturation for purple
      })
      .normalize()
      .toBuffer();

    // Step 2: Process pixel by pixel to extract only purple glow
    const { data, info } = await sharp(enhanced)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const processed = Buffer.allocUnsafe(data.length);
    const width = info.width;
    const height = info.height;

    // Parameters for detecting purple glow
    const minPurpleR = 50;   // Minimum red for purple
    const minPurpleB = 50;   // Minimum blue for purple
    const minBrightness = 30; // Minimum brightness to keep
    const purpleRatio = 1.2;  // R+B should be this much more than G

    console.log('🔄 Removing circuit board background, keeping only purple glow...');

    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;

      // Check if pixel is part of purple glow
      const isPurple = r > minPurpleR && b > minPurpleB && (r + b) > g * purpleRatio;
      const isBrightEnough = brightness > minBrightness;
      
      // Also check if it's a bright pixel (could be glow effect)
      const isGlow = brightness > 60;

      if (isPurple || (isBrightEnough && isGlow)) {
        // Keep this pixel - it's part of the logo
        // Enhance the purple glow
        processed[i] = Math.min(255, r * 1.25);      // Boost red
        processed[i + 1] = Math.min(255, g * 0.75);  // Reduce green
        processed[i + 2] = Math.min(255, b * 1.3);   // Boost blue (purple)
        
        // Set alpha based on how purple/bright it is
        let alpha = 255;
        if (!isPurple && isGlow) {
          // For glow effects, use brightness-based alpha
          alpha = Math.min(255, Math.max(180, brightness * 2.5));
        }
        processed[i + 3] = alpha;
      } else {
        // Make transparent - it's circuit board background
        processed[i] = 0;
        processed[i + 1] = 0;
        processed[i + 2] = 0;
        processed[i + 3] = 0;
      }
    }

    // Create final image
    const finalLogo = await sharp(processed, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4
      }
    })
      .png()
      .toBuffer();

    // Save to public directory
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Resize to 512x512 for web
    await sharp(finalLogo)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'logo.png'));

    // High-DPI version
    await sharp(finalLogo)
      .resize(1024, 1024, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'logo@2x.png'));

    console.log('\n✅ Logo extracted!');
    console.log(`📁 Saved to: ${OUTPUT_DIR}/logo.png`);
    console.log('\n💡 The logo now has:');
    console.log('   ✓ Circuit board background removed');
    console.log('   ✓ Only purple XF + gas pump visible');
    console.log('   ✓ Transparent background');
    console.log('\n🔄 Regenerating favicons...');

    // Regenerate favicons
    const { execSync } = await import('child_process');
    try {
      execSync('npm run generate-favicons', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    } catch (error) {
      console.log('⚠️  Run manually: npm run generate-favicons');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

extractXFLogo();

