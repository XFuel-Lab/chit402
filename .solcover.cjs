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
};
