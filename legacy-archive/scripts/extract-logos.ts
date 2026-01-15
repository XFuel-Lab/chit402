import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_IMAGE = path.join(__dirname, '../edgefarm-mobile/assets/Favorite LOGO Xpump.jpg');
const OUTPUT_DIR = path.join(__dirname, '../assets/logos');

interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function extractLogos() {
  try {
    // Get source image metadata
    const metadata = await sharp(SOURCE_IMAGE).metadata();
    console.log(`Source image dimensions: ${metadata.width}x${metadata.height}`);

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image dimensions');
    }

    // Calculate crop regions based on image description
    // The image has the 3D render on the left and app icon on the right
    const imgWidth = metadata.width;
    const imgHeight = metadata.height;

    // 3D Render (left side) - takes up roughly 60-70% of the width
    const renderRegion: CropRegion = {
      left: 0,
      top: 0,
      width: Math.floor(imgWidth * 0.65), // Left 65% of image
      height: imgHeight
    };

    // App Icon (right side) - takes up roughly 20-30% of the width, centered vertically
    const iconSize = Math.min(
      Math.floor(imgWidth * 0.25), // 25% of width
      Math.floor(imgHeight * 0.3)  // 30% of height
    );
    const iconRegion: CropRegion = {
      left: Math.floor(imgWidth * 0.7), // Start at 70% from left
      top: Math.floor((imgHeight - iconSize) / 2), // Center vertically
      width: iconSize,
      height: iconSize
    };

    console.log('\nExtracting regions:');
    console.log(`3D Render: ${renderRegion.width}x${renderRegion.height} at (${renderRegion.left}, ${renderRegion.top})`);
    console.log(`App Icon: ${iconRegion.width}x${iconRegion.height} at (${iconRegion.left}, ${iconRegion.top})`);

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Extract and process 3D Render for Theta Mainnet
    console.log('\nProcessing 3D Render for Theta Mainnet...');
    const renderImage = sharp(SOURCE_IMAGE)
      .extract(renderRegion)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
      });

    await renderImage
      .png()
      .toFile(path.join(OUTPUT_DIR, 'theta-mainnet-logo-512.png'));

    await renderImage
      .resize(256, 256, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'theta-mainnet-logo-256.png'));

    // Extract and process App Icon for CoinGecko
    console.log('Processing App Icon for CoinGecko...');
    const iconImage = sharp(SOURCE_IMAGE)
      .extract(iconRegion)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      });

    await iconImage
      .png()
      .toFile(path.join(OUTPUT_DIR, 'coingecko-logo-512.png'));

    await iconImage
      .resize(256, 256, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'coingecko-logo-256.png'));

    console.log('\n✅ Successfully extracted logos!');
    console.log(`Output directory: ${OUTPUT_DIR}`);
    console.log('\nGenerated files:');
    console.log('  - theta-mainnet-logo-256.png (256x256)');
    console.log('  - theta-mainnet-logo-512.png (512x512)');
    console.log('  - coingecko-logo-256.png (256x256)');
    console.log('  - coingecko-logo-512.png (512x512)');

  } catch (error) {
    console.error('Error extracting logos:', error);
    process.exit(1);
  }
}

extractLogos();

