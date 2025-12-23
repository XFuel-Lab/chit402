// Jest transformer to replace import.meta.env with mock values
const tsJest = require('ts-jest').default

const envMap = {
  VITE_MULTISIG_ADDRESS: process.env.VITE_MULTISIG_ADDRESS || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257',
  VITE_USDC_ADDRESS_MAINNET: process.env.VITE_USDC_ADDRESS_MAINNET || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257',
  VITE_CONTRIBUTION_WEBHOOK_URL: process.env.VITE_CONTRIBUTION_WEBHOOK_URL || 'https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/',
  VITE_ROUTER_ADDRESS: process.env.VITE_ROUTER_ADDRESS || '',
  VITE_TIP_POOL_ADDRESS: process.env.VITE_TIP_POOL_ADDRESS || '',
}

const transformer = tsJest.createTransformer({
  tsconfig: {
    jsx: 'react-jsx',
    target: 'es2020',
    module: 'esnext',
  },
  isolatedModules: true,
})

module.exports = {
  process(sourceText, sourcePath, options) {
    // Replace import.meta.env.VARIABLE with the actual value as a string literal
    let transformedSource = sourceText
    
    // Handle patterns like: import.meta.env.VITE_XXX || 'default'
    transformedSource = transformedSource.replace(
      /import\.meta\.env\.(\w+)(\s*\|\|\s*[^;,\n)]+)?/g,
      (match, envVar, fallback) => {
        const value = envMap[envVar] !== undefined ? envMap[envVar] : ''
        if (fallback) {
          // Keep the fallback logic but replace import.meta.env.XXX with the value
          return `${JSON.stringify(value)}${fallback}`
        }
        return JSON.stringify(value)
      }
    )
    
    // Process with ts-jest
    return transformer.process(transformedSource, sourcePath, options)
  },
  getCacheKey(sourceText, sourcePath, options) {
    return transformer.getCacheKey(sourceText, sourcePath, options)
  },
}

