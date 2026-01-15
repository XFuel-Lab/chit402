# Logo Extraction Guide

This guide explains how to extract logos from the source image for use with Theta Mainnet and CoinGecko.

## Quick Start

Run the extraction script:

```bash
npm run extract-logos
```

This will generate:
- `assets/logos/theta-mainnet-logo-256.png` - 256x256 for Theta Mainnet
- `assets/logos/theta-mainnet-logo-512.png` - 512x512 for Theta Mainnet
- `assets/logos/coingecko-logo-256.png` - 256x256 for CoinGecko
- `assets/logos/coingecko-logo-512.png` - 512x512 for CoinGecko

## Source Image

The source image is located at:
- `edgefarm-mobile/assets/Favorite LOGO Xpump.jpg`

This image contains:
1. **3D Render (Left Side)**: A detailed 3D rendering with purple glowing "X" and gas pump nozzle
2. **App Icon (Right Side)**: A simplified purple app icon with white X and gas pump graphics

## Customizing Crop Regions

If you need to adjust the crop regions, edit `scripts/extract-logos.ts` and modify these values:

### 3D Render Region (for Theta Mainnet)
```typescript
const renderRegion: CropRegion = {
  left: 0,                    // Start from left edge
  top: 0,                     // Start from top edge
  width: Math.floor(imgWidth * 0.65),  // 65% of image width
  height: imgHeight           // Full height
};
```

### App Icon Region (for CoinGecko)
```typescript
const iconSize = Math.min(
  Math.floor(imgWidth * 0.25),  // 25% of width
  Math.floor(imgHeight * 0.3)   // 30% of height
);
const iconRegion: CropRegion = {
  left: Math.floor(imgWidth * 0.7),  // Start at 70% from left
  top: Math.floor((imgHeight - iconSize) / 2),  // Center vertically
  width: iconSize,
  height: iconSize
};
```

## Logo Requirements

### Theta Mainnet
- **Format**: PNG
- **Recommended sizes**: 256x256 or 512x512
- **Background**: Transparent (current implementation)
- **Use case**: Token logo for Theta blockchain explorer

### CoinGecko
- **Format**: PNG
- **Recommended sizes**: 256x256 or 512x512
- **Background**: Transparent or solid color
- **Use case**: Token listing on CoinGecko

## Advanced: Manual Crop Coordinates

If the automatic crop regions don't work well, you can specify exact pixel coordinates:

1. Open the source image in an image editor
2. Note the exact coordinates of the regions you want
3. Update the script with hardcoded values:

```typescript
// Example with exact coordinates
const renderRegion: CropRegion = {
  left: 0,
  top: 0,
  width: 624,  // Exact pixel width
  height: 960  // Exact pixel height
};
```

## Troubleshooting

### Images look cropped incorrectly
- Check the source image dimensions in the console output
- Adjust the percentage values in the crop region calculations
- Consider using exact pixel coordinates if percentages don't work

### Output images are too small/large
- The script automatically resizes to 256x256 and 512x512
- The `fit: 'contain'` option preserves aspect ratio
- To fill the entire canvas, change to `fit: 'cover'`

### Background issues
- Current implementation uses transparent backgrounds
- To add a solid background, modify the `background` option in the resize calls

## Next Steps

After extraction:
1. Review the generated logos in `assets/logos/`
2. Test them in your application
3. Upload to Theta Mainnet token registry
4. Submit to CoinGecko for listing

