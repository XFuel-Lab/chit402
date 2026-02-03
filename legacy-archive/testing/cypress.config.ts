import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:3000',
    setupNodeEvents(on, config) {
      // E2E testing environment configuration
      config.env.BACKEND_URL = process.env.CYPRESS_BACKEND_URL || 'http://localhost:3001'
      config.env.NETWORK = process.env.CYPRESS_NETWORK || 'testnet'
      config.env.ENABLE_REAL_WALLETS = process.env.CYPRESS_REAL_WALLETS === 'true'
      
      // Performance monitoring
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.name === 'chrome') {
          launchOptions.args.push('--disable-dev-shm-usage')
          launchOptions.args.push('--disable-gpu')
        }
        return launchOptions
      })

      // Task for checking backend health
      on('task', {
        async checkBackendHealth() {
          try {
            const response = await fetch('http://localhost:3001/health')
            return { status: response.status, ok: response.ok }
          } catch (error) {
            return { status: 0, ok: false, error: error.message }
          }
        }
      })
      
      return config
    },
    viewportWidth: 1280,
    viewportHeight: 720,
    video: true,
    screenshotOnRunFailure: true,
    videoCompression: 32,
    videoUploadOnPasses: false,
    chromeWebSecurity: false, // Allow cross-origin requests for wallet testing
    experimentalStudio: true,
    retries: {
      runMode: 2,
      openMode: 0,
    },
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 30000,
    requestTimeout: 10000,
    responseTimeout: 30000,
    watchForFileChanges: true,
  },
  component: {
    devServer: {
      framework: 'react',
      bundler: 'vite',
    },
  },
})

