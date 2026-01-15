import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// You can specify the source image path here, or pass as argument
const SOURCE_IMAGE = process.argv[2] || path.join(__dirname, '../edgefarm-mobile/assets/Favorite LOGO Xpump.jpg');
const OUTPUT_DIR = path.join(__dirname, '../public');

async function extractLogoBubble() {
  try {
    if (!fs.existsSync(SOURCE_IMAGE)) {
      console.error(`❌ Source image not found: ${SOURCE_IMAGE}`);
      console.log('\nUsage: npm run extract-logo-bubble [path-to-image]');
      console.log('Example: npm run extract-logo-bubble ./my-logo.jpg');
      process.exit(1);
    }

    console.log('🎨 Extracting logo bubble (XF + gas pump) from image...\n');
    console.log(`📁 Source: ${SOURCE_IMAGE}`);

    // Get image metadata
    const metadata = await sharp(SOURCE_IMAGE).metadata();
    console.log(`📐 Image dimensions: ${metadata.width}x${metadata.height}`);

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image dimensions');
    }

    const imgWidth = metadata.width;
    const imgHeight = metadata.height;

    // Strategy: Extract center portion where the XF logo is
    // Crop a square from the center focusing on the logo
    const cropSize = Math.min(
      Math.floor(imgWidth * 0.7),  // Take 70% of width
      Math.floor(imgHeight * 0.7)  // Take 70% of height
    );
    
    const left = Math.floor((imgWidth - cropSize) / 2);
    const top = Math.floor((imgHeight - cropSize) / 2);

    console.log(`\n✂️  Cropping center region: ${cropSize}x${cropSize} at (${left}, ${top})`);

    // Step 1: Extract center region with the logo
    const cropped = await sharp(SOURCE_IMAGE)
      .extract({
        left,
        top,
        width: cropSize,
        height: cropSize
      })
      .resize(1024, 1024, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    // Save debug: cropped version
    await sharp(cropped)
      .png()
      .toFile(path.join(OUTPUT_DIR, 'logo-debug-cropped.png'));

    console.log('🔄 Processing: Removing dark background, keeping purple glow...');

    // Step 2: Enhanced background removal with better edge detection
    // First, enhance the image to make purple glow more visible
    const enhanced = await sharp(cropped)
      .modulate({
        brightness: 1.4,  // Brighten to make glow more visible
        saturation: 1.3   // Increase saturation for purple
      })
      .normalize()
      .toBuffer();

    // Convert to RGBA and process each pixel
    const { data, info } = await sharp(enhanced)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const processed = Buffer.allocUnsafe(data.length);
    
    // More aggressive thresholds for better background removal
    const darkThreshold = 25;      // Very dark pixels = background
    const glowThreshold = 35;      // Minimum brightness for glow
    const purpleMinR = 80;          // Minimum red for purple
    const purpleMinB = 80;          // Minimum blue for purple
    
    // Track logo pixels for edge detection
    const logoPixels = new Set<number>();
    
    // First pass: Identify logo pixels
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      
      // Check if it's purple/glowing (the logo)
      const isPurple = r > purpleMinR && b > purpleMinB && (r + b) > g * 1.5;
      const isGlowing = brightness > glowThreshold;
      const isNotDark = brightness > darkThreshold;
      
      if (isPurple || (isGlowing && isNotDark)) {
        logoPixels.add(i);
      }
    }
    
    // Second pass: Process pixels with edge preservation
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      
      const isLogoPixel = logoPixels.has(i);
      
      // Check neighbors for edge detection (preserve edges even if slightly dark)
      let hasLogoNeighbor = false;
      const pixelIndex = i / 4;
      const width = info.width;
      const height = info.height;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      
      // Check 8 neighbors
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const neighborIndex = (ny * width + nx) * 4;
            if (logoPixels.has(neighborIndex)) {
              hasLogoNeighbor = true;
              break;
            }
          }
        }
        if (hasLogoNeighbor) break;
      }
      
      // Keep pixel if:
      // 1. It's a logo pixel
      // 2. It's near a logo pixel (edge preservation)
      // 3. It's bright enough and not too dark
      if (isLogoPixel || (hasLogoNeighbor && brightness > darkThreshold + 10)) {
        // Enhance purple glow
        processed[i] = Math.min(255, r * 1.15);      // Enhance red
        processed[i + 1] = Math.min(255, g * 0.85);  // Reduce green
        processed[i + 2] = Math.min(255, b * 1.2);   // Enhance blue
        // Preserve alpha based on brightness
        processed[i + 3] = Math.min(255, Math.max(180, brightness * 1.2));
      } else {
        // Make background transparent
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

    // Save main logo
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Save debug: processed version before resize
    await sharp(finalLogo)
      .png()
      .toFile(path.join(OUTPUT_DIR, 'logo-debug-processed.png'));

    // Resize to 512x512 for web use
    await sharp(finalLogo)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'logo.png'));

    // Also create a larger version for high-DPI displays
    await sharp(finalLogo)
      .resize(1024, 1024, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'logo@2x.png'));

    console.log('\n✅ Logo bubble extraction complete!');
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);
    console.log('\nGenerated files:');
    console.log('  - logo.png (512x512, transparent background)');
    console.log('  - logo@2x.png (1024x1024, for high-DPI)');
    console.log('\n💡 The logo now has:');
    console.log('   ✓ Dark background removed');
    console.log('   ✓ Only XF logo + gas pump visible');
    console.log('   ✓ Purple glow preserved');
    console.log('   ✓ Transparent background (bubble/tab ready)');
    console.log('\n🔄 Regenerating favicons with new logo...');

    // Regenerate favicons with the new logo
    const { execSync } = await import('child_process');
    try {
      execSync('npm run generate-favicons', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    } catch (error) {
      console.log('⚠️  Could not auto-regenerate favicons. Run manually: npm run generate-favicons');
    }

  } catch (error) {
    console.error('❌ Error extracting logo:', error);
    process.exit(1);
  }
}

extractLogoBubble();
