module.exports = {
  skipFiles: [
    'legacy/',
    'mocks/',
    'test-helpers/',
  ],
  configureYulOptimizer: true,
  solcOptimizerDetails: {
    yul: true,
    yulDetails: {
      stackAllocation: true,
    },
  },
  // Minimum coverage thresholds — CI fails below these numbers.
  // Scoped to audit-phase contracts (contracts/core/).
  // Raise thresholds incrementally as coverage improves.
  istanbulThresholds: {
    statements: 80,
    branches: 70,
    functions: 85,
    lines: 80,
  },
  istanbulReporter: ['html', 'lcov', 'text', 'json-summary'],
};
