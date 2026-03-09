import { createRequire } from 'module';
const require = createRequire(import.meta.url);

require('./security/ContractFuzz.test.cjs');
require('./security/AuditSecurity.test.cjs');
require('./security/SP1ProofHooksHarness.test.cjs');
require('./security/ZKVerifierExpanded.test.cjs');
require('./security/SplitterBranches.test.cjs');
require('./security/SplitterCoverage.test.cjs');
require('./security/InferenceBranches.test.cjs');
require('./phase3/CoreRevenueSplitter.test.cjs');
require('./phase3/veXFGovernance.test.cjs');
require('./phase3/E2E.governance.test.cjs');
require('./priority-circuits/PriorityCircuits.test.cjs');
require('../core-layer/test/ZKVerifierSP1.test.cjs');
require('../circuits/theta-inference/test/ThetaInferenceCircuit.test.cjs');
require('./circuits/ThetaInference.test.cjs');
