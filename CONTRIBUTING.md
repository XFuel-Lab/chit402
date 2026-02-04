# Contributing to XFuel Protocol

Thank you for your interest in contributing to XFuel Protocol! This document provides guidelines for contributions to help maintain code quality and project consistency.

---

## 🎯 Ways to Contribute

### 1. **Bug Reports**
- Search existing issues first
- Use the bug report template
- Include reproduction steps
- Provide environment details (OS, Node version, etc.)

### 2. **Feature Requests**
- Check roadmap first ([docs/overhaul/ZK_OVERHAUL_SUMMARY.md](docs/overhaul/ZK_OVERHAUL_SUMMARY.md))
- Explain the use case clearly
- Consider backward compatibility
- Propose implementation approach

### 3. **Code Contributions**
- Smart contract improvements
- Frontend/backend optimizations
- Documentation updates
- Test coverage enhancements

### 4. **Documentation**
- Fix typos and clarifications
- Add examples and tutorials
- Improve setup guides
- Translate documentation

---

## 🔧 Development Setup

### Prerequisites

```bash
# Node.js 18+ and npm 9+
node --version
npm --version

# For smart contracts
npx hardhat --version

# For CosmWasm (optional)
cargo --version
rustc --version
```

### Quick Start

```bash
# Clone the repository
git clone https://github.com/XFuel-Lab/xfuel-protocol.git
cd xfuel-protocol

# Install dependencies
npm install

# Set up environment
cp env.example .env.local
# Edit .env.local with your configuration

# Run tests
npm test

# Start development server
npm run dev
```

---

## 📋 Contribution Workflow

### 1. **Fork & Branch**

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/xfuel-protocol.git
cd xfuel-protocol

# Add upstream remote
git remote add upstream https://github.com/XFuel-Lab/xfuel-protocol.git

# Create feature branch
git checkout -b feature/your-feature-name
```

### 2. **Make Changes**

- Follow existing code style
- Write clear commit messages
- Add tests for new features
- Update documentation as needed

### 3. **Test Your Changes**

```bash
# Run all tests
npm test

# Run E2E tests
npm run test:e2e

# Check linting
npm run lint

# Type checking
npm run type-check
```

### 4. **Commit Guidelines**

Use conventional commit format:

```
feat: add LST auto-routing optimization
fix: resolve MetaMask connection issue
docs: update deployment guide
test: add coverage for ZK proof validation
refactor: simplify bridge settlement logic
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test additions/changes
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Build process or tooling changes

### 5. **Create Pull Request**

```bash
# Push your branch
git push origin feature/your-feature-name

# Go to GitHub and create a PR
# Fill out the PR template completely
```

**PR Checklist:**
- [ ] Tests pass locally
- [ ] Code follows project style
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] No merge conflicts
- [ ] PR description explains changes

---

## 🏗️ Project Structure

```
xfuel-protocol/
├── src/                    # Frontend (Next.js/React)
│   ├── components/         # UI components
│   ├── config/             # Configuration
│   └── utils/              # Utilities
├── contracts/              # Solidity contracts (Theta)
├── cosmwasm/               # Rust contracts (Persistence)
├── backend/                # Node.js backend services
├── scripts/                # Deployment & utility scripts
│   └── deploy/             # Deployment scripts
├── test/                   # Test files
├── docs/                   # Documentation
│   ├── overhaul/           # ZK overhaul docs
│   └── whitepaper/         # Technical whitepapers
└── cypress/                # E2E tests
```

---

## 🎨 Code Style Guidelines

### TypeScript/JavaScript

```typescript
// Use TypeScript strict mode
// Prefer functional components
// Use descriptive variable names
// Add JSDoc comments for complex functions

/**
 * Generates SP1 zkVM proof for deposit validation
 * @param deposit - Deposit transaction details
 * @returns SP1 proof object (RISC-V → STARK → Groth16 wrapper)
 */
async function generateProof(deposit: Deposit): Promise<SP1Proof> {
  // Implementation
}
```

### Solidity

```solidity
// Follow Solidity style guide
// Use NatSpec comments
// Prefer explicit over implicit
// Security first - check-effects-interactions

/**
 * @notice Deposits TFUEL and initiates cross-chain transfer
 * @param amount Amount of TFUEL to deposit
 * @param cosmosRecipient Recipient address on Cosmos chain
 */
function deposit(uint256 amount, string calldata cosmosRecipient) external payable {
    // Implementation
}
```

### Rust (CosmWasm)

```rust
// Follow Rust conventions
// Use Result types
// Prefer explicit error handling
// Add doc comments

/// Verifies SP1 zkVM proof (STARK → Groth16 wrapper)
/// 
/// # Arguments
/// * `proof` - The SP1 proof to verify (compressed Groth16 format)
/// * `public_inputs` - Public inputs for verification
///
/// # Returns
/// * `Result<Response, ContractError>` - Success or error
pub fn verify_proof(proof: Proof, public_inputs: Vec<String>) -> Result<Response, ContractError> {
    // Implementation
}
```

---

## 🧪 Testing Standards

### Unit Tests

```typescript
describe('ZKProofGenerator', () => {
  it('should generate valid SP1 zkVM proof in <10s', async () => {
    const deposit = createMockDeposit();
    const start = Date.now();
    const proof = await generateProof(deposit);
    const duration = Date.now() - start;
    
    expect(proof).toBeDefined();
    expect(proof.proof).toBeDefined(); // SP1 proof bytes
    expect(proof.publicInputs).toBeDefined();
    expect(duration).toBeLessThan(10000); // ~9s avg (Phase B: 8.997s)
  });
});
```

### Integration Tests

```typescript
describe('E2E Bridge Flow', () => {
  it('should complete deposit to LST in <12s', async () => {
    // Test full bridge flow
    // Verify all steps complete
    // Check settlement time (Phase B: ~11-12s avg)
    // - Deposit: 2-6s
    // - SP1 proof: ~9s
    // - CosmWasm verify: ~100ms
    // - IBC transfer: ~1-2s
  });
});
```

---

## 🔒 Security Guidelines

### Smart Contracts

- Use OpenZeppelin libraries where possible
- Follow checks-effects-interactions pattern
- Add reentrancy guards
- Implement emergency pause mechanisms
- Write comprehensive tests

### Backend Services

- Validate all inputs
- Use environment variables for secrets
- Implement rate limiting
- Log security-relevant events
- Handle errors gracefully

### Reporting Vulnerabilities

**DO NOT** create public issues for security vulnerabilities.

Instead, email: **security@xfuel.app**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to respond within 48 hours and will keep you updated on the fix progress.

---

## 📚 Documentation Standards

### Code Comments

```typescript
// Good: Explains WHY, not WHAT
// Use parallel proof generation to reduce latency by 50%
const proof = await generateProofParallel(deposit);

// Bad: States the obvious
// Generate proof
const proof = await generateProof(deposit);
```

### README Updates

- Keep examples up to date
- Test all code snippets
- Update version numbers
- Check all links work

### Whitepaper Contributions

Currently, whitepaper updates are managed by core team to ensure consistency. If you have suggestions:
1. Open an issue with `[whitepaper]` prefix
2. Provide detailed rationale
3. Include supporting data/research

---

## 🌍 Community Guidelines

### Be Respectful

- Treat everyone with respect
- Value diverse perspectives
- Assume good intentions
- Be constructive in feedback

### Communication Channels

- **GitHub Issues:** Bug reports, feature requests
- **GitHub Discussions:** General questions, ideas
- **Discord:** Real-time chat (coming soon)
- **Twitter:** [@xfuel_protocol](https://twitter.com/xfuel_protocol)

### Code of Conduct

We follow the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

Key points:
- Be welcoming and inclusive
- Respect differing viewpoints
- Accept constructive criticism
- Focus on what's best for the community

---

## 🏆 Recognition

Contributors are recognized in multiple ways:

### Documentation

- Contributors list in README
- Release notes mention
- Whitepaper acknowledgments (for significant contributions)

### NFT Rewards (Future)

- Special NFTs for significant contributors
- Governance participation rights
- Early access to new features

### Bug Bounty Program (Coming Soon)

- Up to $500K for critical vulnerabilities
- Rewards for valid bug reports
- Recognition in security hall of fame

---

## 🚀 Getting Help

### Resources

- **Documentation:** [docs/](docs/)
- **Quick Reference:** [docs/XFUEL-FERRARI-QUICK-REF.md](docs/XFUEL-FERRARI-QUICK-REF.md)
- **ZK Overhaul:** [docs/overhaul/ZK_OVERHAUL_SUMMARY.md](docs/overhaul/ZK_OVERHAUL_SUMMARY.md)
- **Deployment Guides:** [STEP5_E2E_BRIDGE_TEST_GUIDE.md](STEP5_E2E_BRIDGE_TEST_GUIDE.md)

### Questions?

1. Check existing documentation
2. Search closed issues
3. Ask in GitHub Discussions
4. Join Discord (coming soon)

---

## 📝 License

By contributing to XFuel Protocol, you agree that your contributions will be licensed under the MIT License.

See [LICENSE](LICENSE) for details.

---

## 🎯 Priorities for Contributors

### High Priority

- [ ] Test coverage improvements (target: 95%+)
- [ ] Mobile app optimization
- [ ] Additional LST integrations (stkATOM, stkOSMO)
- [ ] Gas optimization in smart contracts
- [ ] Documentation improvements

### Medium Priority

- [ ] UI/UX enhancements
- [ ] Performance monitoring
- [ ] Error handling improvements
- [ ] Internationalization (i18n)
- [ ] Example implementations

### Future Enhancements

- [ ] Multi-chain bridge expansion
- [ ] AI yield optimizer
- [ ] ZK rollup integration
- [ ] Cross-chain DEX aggregation
- [ ] Mobile wallet support

---

## 📅 Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR:** Breaking changes
- **MINOR:** New features (backward compatible)
- **PATCH:** Bug fixes

Current version: **v3.0.0** (Ferrari Edition)

### Release Cycle

- **Patch releases:** As needed for critical bugs
- **Minor releases:** Monthly
- **Major releases:** Quarterly

---

## ✨ Thank You!

Your contributions make XFuel Protocol better for everyone. Whether it's code, documentation, bug reports, or community support—every contribution matters.

**Welcome to the XFuel community!** 🏎️⚡

---

**Last Updated:** January 4, 2026  
**Version:** 1.0  
**Maintainers:** XFuel Core Team

For questions about contributing, email: **contribute@xfuel.app**

