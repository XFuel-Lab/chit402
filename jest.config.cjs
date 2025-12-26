/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  transform: {
    '^.+\\.tsx?$': ['./jest-import-meta-transform.cjs', {
      tsconfig: {
        jsx: 'react-jsx',
        target: 'es2020',
        module: 'esnext',
      },
      isolatedModules: true,
    }],
    '^.+\\.jsx?$': ['./jest-import-meta-transform.cjs', {
      tsconfig: {
        jsx: 'react-jsx',
        target: 'es2020',
        module: 'commonjs',
        allowJs: true,
      },
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@walletconnect|uint8arrays|multiformats|lucide-react|@cosmjs|@scure)/)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^lucide-react$': '<rootDir>/__mocks__/lucide-react.js',
    '^@walletconnect/ethereum-provider$': '<rootDir>/__mocks__/@walletconnect/ethereum-provider.js',
  },
  setupFilesAfterEnv: ['<rootDir>/setupTests.ts'],
  globals: {
    'import.meta': {
      env: {
        VITE_MULTISIG_ADDRESS: process.env.VITE_MULTISIG_ADDRESS || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257',
        VITE_USDC_ADDRESS_MAINNET: process.env.VITE_USDC_ADDRESS_MAINNET || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257',
        VITE_CONTRIBUTION_WEBHOOK_URL: process.env.VITE_CONTRIBUTION_WEBHOOK_URL || 'https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/',
      },
    },
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/main.tsx',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
}

