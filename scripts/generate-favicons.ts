import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the new logo from public, or fallback to assets
const SOURCE_LOGO = fs.existsSync(path.join(__dirname, '../public/logo.png'))
  ? path.join(__dirname, '../public/logo.png')
  : path.join(__dirname, '../assets/logos/theta-mainnet-logo-512.png');
const PUBLIC_DIR = path.join(__dirname, '../public');

async function generateFavicons() {
  try {
    // Create public directory if it doesn't exist
    if (!fs.existsSync(PUBLIC_DIR)) {
      fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    }

    console.log('🎨 Generating favicons and logo files...\n');

    // 1. Full size logo (512x512) - only copy if source is different
    const logoOutputPath = path.join(PUBLIC_DIR, 'logo.png');
    if (SOURCE_LOGO !== logoOutputPath) {
      console.log('📦 Copying full size logo (512x512)...');
      await sharp(SOURCE_LOGO)
        .png()
        .toFile(logoOutputPath);
    } else {
      console.log('📦 Logo already in place, skipping copy...');
    }

    // 2. Favicon (32x32) - ICO format
    console.log('🔖 Generating favicon.ico (32x32)...');
    const favicon32 = await sharp(SOURCE_LOGO)
      .resize(32, 32, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    
    // Save as PNG (browsers accept PNG for favicon)
    fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.png'), favicon32);
    fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.ico'), favicon32);

    // 3. Apple touch icon (180x180)
    console.log('🍎 Generating apple-touch-icon.png (180x180)...');
    await sharp(SOURCE_LOGO)
      .resize(180, 180, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(PUBLIC_DIR, 'apple-touch-icon.png'));

    // 4. CoinGecko logo (512x512)
    console.log('🪙 Copying CoinGecko logo (512x512)...');
    const coingeckoSource = path.join(__dirname, '../assets/logos/coingecko-logo-512.png');
    if (fs.existsSync(coingeckoSource)) {
      await sharp(coingeckoSource)
        .png()
        .toFile(path.join(PUBLIC_DIR, 'coingecko-logo.png'));
    } else {
      // Fallback to main logo if CoinGecko version doesn't exist
      await sharp(SOURCE_LOGO)
        .png()
        .toFile(path.join(PUBLIC_DIR, 'coingecko-logo.png'));
    }

    // 5. Additional sizes for better browser support
    console.log('📱 Generating additional icon sizes...');
    
    // 16x16 for small favicons
    await sharp(SOURCE_LOGO)
      .resize(16, 16, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(PUBLIC_DIR, 'favicon-16x16.png'));

    // 192x192 for Android
    await sharp(SOURCE_LOGO)
      .resize(192, 192, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(PUBLIC_DIR, 'android-chrome-192x192.png'));

    // 512x512 for Android
    await sharp(SOURCE_LOGO)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(PUBLIC_DIR, 'android-chrome-512x512.png'));

    console.log('\n✅ Successfully generated all favicon and logo files!');
    console.log(`📁 Output directory: ${PUBLIC_DIR}`);
    console.log('\nGenerated files:');
    console.log('  - logo.png (512x512)');
    console.log('  - favicon.ico (32x32)');
    console.log('  - favicon.png (32x32)');
    console.log('  - favicon-16x16.png (16x16)');
    console.log('  - apple-touch-icon.png (180x180)');
    console.log('  - android-chrome-192x192.png (192x192)');
    console.log('  - android-chrome-512x512.png (512x512)');
    console.log('  - coingecko-logo.png (512x512)');

  } catch (error) {
    console.error('❌ Error generating favicons:', error);
    process.exit(1);
  }
}

generateFavicons();

