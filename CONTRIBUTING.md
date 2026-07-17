# Contributing to XFuel Protocol

Welcome to XFuel Protocol! We're building the **verifiable settlement and payments layer for AI compute** (agent routing, USDC on Base, tiered receipts), and we'd love your help making it production-ready.

---

## About This Project

XFuel is a **provider-agnostic router + verifier**: route inference to the best available provider, settle in **USDC via x402 on Base**, and return verifiable receipts (signed or on-chain SP1). Money and proof home is **Base** ([ADR 0002](docs/adr/0002-base-settlement-home.md)); EdgeCloud and other GPU networks are **optional provider tiers**. Core work includes `ZKVerifierSP1`, the gateway (`services/gateway`), SP1 proving, SDK/MCP, and circuits. Legacy `CoreRevenueSplitter` is deprecated from the go-forward fee path (ADR 0001).

**Current Status:** All 6 development phases complete (755+ tests). Preparing for CertiK Phase 1 audit (Q2 2026) and grant submissions.

### Solo-Dev Context

This project is currently developed by a solo founder with no prior dev experience, heavily leveraging AI tools:
- **Cursor + Claude Sonnet 4.5**: Primary code generation and reviews
- **Grok**: Architecture decisions and debugging
- **AI-assisted workflow**: ~80% of code initially generated, then refined through testing

We welcome contributors who can help validate, optimize, and expand this AI-generated codebase as we move toward production.

---

## 🎯 Why Contribute?

**For Web3 Developers:**
- Work on cutting-edge ZK verification technology (SP1 zkVM, Groth16/PLONK proofs)
- Gain experience with Solidity, CosmWasm, and cross-chain systems (Hyperlane, IBC)
- Build your reputation in the Theta, Bittensor, and Cosmos ecosystems

**For Marketing & Community Builders:**
- Shape the narrative of a groundbreaking cross-chain protocol
- Grow your web3 marketing portfolio (social media, growth hacking, partnerships)
- Engage with passionate Theta and Cosmos communities

**Post-Launch Rewards:**
- Earn **veXF tokens** for contributions—**especially impactful for marketing/community work** (governance + yield boost)
- Recognition in project credits, whitepaper, and X shoutouts
- Priority access to governance roles and paid positions (if funding secured)

**For the Ecosystem:**
- Help secure $5M+ TVL in cross-chain liquidity
- Enable 30-50% APY yields for TFUEL holders
- Expand DeFi opportunities for Theta Network users

---

## 🏁 How to Get Started

### Quick Wins (Perfect First Contributions)

Start with low-risk tasks to build familiarity—**no coding required** for many:

1. **Marketing & Community (Non-Technical)**
   - Draft X/Twitter posts about XFuel features ([live app](https://xfuel.app))
   - Analyze beta user feedback from Discord/X (sentiment analysis)
   - Suggest partnership outreach ideas (Theta/Cosmos communities)
   - Create memes or graphics for social media campaigns

2. **Documentation Improvements**
   - Fix typos or clarify sections in [README.md](README.md) or [WHITEPAPER.md](WHITEPAPER.md)
   - Add examples to deployment guides
   - Update outdated links or references

3. **Testing & Bug Reports**
   - Test the [live app](https://xfuel.app) and report issues
   - Review contract code and flag potential vulnerabilities
   - Test edge cases in the reverse bridge flow

4. **Code Review (Technical)**
   - Review open PRs (use AI tools like Cursor to analyze changes)
   - Suggest gas optimizations in [ZKVerifierSP1.sol](contracts/core/ZKVerifierSP1.sol) or [CoreRevenueSplitter.sol](contracts/core/CoreRevenueSplitter.sol)
   - Validate SP1 proof logic in [services/sp1-prover/host/src/main.rs](services/sp1-prover/host/src/main.rs)

### Setup Instructions

**Prerequisites:**
- Node.js 20+, npm 10+
- Rust toolchain (for CosmWasm/SP1)
- Hardhat (for Solidity contracts)

**Clone and Install:**
```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/xfuel-protocol.git
cd xfuel-protocol

# Install dependencies
npm install

# Run tests (no blockchain required)
npm test

# Start frontend dev server
npm run dev
```

For detailed setup, see [README.md](README.md#-development-setup).

---

## 🎭 Roles and Opportunities

We need diverse skills beyond just coding! Here's how you can help:

### 👨‍💻 Technical Contributors
**Skills:** Solidity, Rust, TypeScript, ZK proofs
- Smart contract development and optimization
- SP1 zkVM circuit improvements
- Backend automation (Node.js, Theta Edge Cloud)
- Frontend UX enhancements (React, TailwindCSS)
- Security audits and fuzz testing

**Start with:** Code reviews, test additions, bug fixes

### 📣 Marketing & Community
**Skills:** Social media, content creation, community management
- **Social Media**: Draft X/Twitter posts, create engagement campaigns, manage @xfuel_protocol
- **Content Creation**: Write blog posts, create explainer videos, design memes/graphics
- **Community Building**: Set up Discord server, host AMAs, onboard new users
- **User Engagement**: Analyze feedback from beta users, improve chatbot prompts
- **Partnership Outreach**: Identify and reach out to Theta/Cosmos projects for collaborations
- **Growth Strategy**: Brainstorm hype tactics, plan launch campaigns

**Start with:** Drafting 5 tweets about XFuel features, analyzing sentiment from X mentions, suggesting Discord channel structure

### 📝 Documentation & Design
**Skills:** Technical writing, UX/UI design
- Write tutorials and guides (e.g., "How to bridge TFUEL in 60 seconds")
- Improve whitepaper clarity
- Design UI mockups for governance dashboard
- Create infographics explaining ZK bridge architecture

**Start with:** Fix typos, add examples to existing docs, suggest UI improvements

### 🤝 Other Roles
- **Governance Prep**: Help draft Persistence proposal, research tokenomics
- **Testing**: Manual QA testing, edge case discovery
- **Research**: Analyze competitors (LayerZero, Wormhole), suggest improvements

**Open to all:** Check GitHub issues labeled `good first issue`, `marketing`, `community`, or `documentation`.

---

## 📋 Contribution Guidelines

### 1. Use GitHub Issues

- **Search first:** Check if your issue/idea already exists
- **Label appropriately:** Use `bug`, `enhancement`, `documentation`, `marketing`, `community`, etc.
- **Good first issue:** Look for labels like:
  - `good first issue` (technical)
  - `marketing` (social media, content)
  - `community` (Discord, user engagement)
  - `documentation` (writing, examples)

### 2. Pull Request Process

**Branch Naming:**
```bash
feature/add-reverse-bridge-ui    # New features
fix/nonce-desync-bug             # Bug fixes
docs/update-deployment-guide     # Documentation
test/add-e2e-reverse-flow        # Tests
marketing/x-campaign-q2          # Marketing content
community/discord-setup          # Community initiatives
```

**Commit Standards (Conventional Commits):**
```
feat: add reverse bridge UI component
fix: resolve nonce desync in unwrap flow
docs: clarify SP1 proof generation steps
test: add E2E test for burn_for_unwrap
refactor: optimize gas usage in ZKVerifierSP1
marketing: draft X campaign for Phase D launch
community: create Discord welcome bot template
```

**PR Checklist:**
- [ ] Tests pass locally (`npm test`)
- [ ] Code follows project style (see below)
- [ ] Documentation updated (if applicable)
- [ ] No merge conflicts with `main` branch
- [ ] PR description explains the "why" (not just "what")

### 3. Code Style

**TypeScript/JavaScript:**
- Use Prettier (auto-format on save recommended)
- Prefer functional components in React
- Add JSDoc comments for complex functions

**Solidity:**
- Follow [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- Use NatSpec comments (`@notice`, `@param`, `@return`)
- Run `npx hardhat compile` before committing

**Rust (CosmWasm):**
- Use `rustfmt` (run `cargo fmt` before committing)
- Add doc comments (`///`) for public functions
- Handle errors explicitly (no `.unwrap()` in production code)

**Marketing/Community Content:**
- Use clear, concise Markdown for docs (e.g., campaign plans, Discord guides)
- Keep tone consistent with project branding (cyberpunk, trustless, accessible)
- For social media drafts, include character counts for X/Twitter (280 limit)

### 4. Testing Requirements

**Before Submitting a PR:**
```bash
# Run unit tests
npm test

# Check TypeScript types
npm run type-check

# Lint code
npm run lint

# For contract changes, run Hardhat tests
npx hardhat test
```

**For New Features:**
- Add unit tests (target: 95%+ coverage)
- Add integration tests if cross-component
- Update E2E tests if user-facing

---

## 🤖 Automation and AI Tools

We embrace AI-assisted development and automation! Here's how contributors can leverage tools:

### AI for Code & Content
- **Cursor + Sonnet 4.5**: Use for code reviews, refactoring, content drafting (X posts, docs)
- **GitHub Copilot**: Enable for faster boilerplate generation
- **Grok**: Use for architectural questions or marketing strategy brainstorming
- **ChatGPT/Claude**: Draft blog posts, explainer scripts, or community FAQs

### Theta RAG Bots (Coming Soon)
- Query Theta documentation without leaving your IDE
- Ask questions like "How does Theta's RPC differ from Ethereum?"

### Automation Priorities (Phase 1: User Engagement)
We're building bots on Theta Edge Cloud for:
- **X/Twitter bot**: Auto-reply to @mentions, post updates, share metrics (TVL, proof times)
- **User feedback analyzer**: Parse Discord/X sentiment for product insights (marketing impact metrics)
- **Yield optimizer**: Auto-route liquidity to highest APY LSTs (Phase D technical)
- **Community chatbot**: Answer FAQs on Discord, onboard new users

**Want to help?** Check issues labeled `automation`, `bot`, or `marketing-automation`.

### Tools for Marketing Contributors
- **Canva**: Design social media graphics (cyberpunk theme templates available)
- **Buffer/Hootsuite**: Schedule X posts (founder can grant access)
- **Google Analytics**: Track xfuel.app traffic (request access for growth analysis)

---

## 🛤️ Building Trust and Onboarding

We understand you may be skeptical of a solo-dev project. Here's how we build trust:

### Start Small, Prove Value
1. **Technical:** Review existing code, comment on PRs, suggest improvements
2. **Non-technical:** Draft 3-5 tweets, analyze user feedback, suggest Discord channels
3. **Testing:** Use the [beta app](https://xfuel.app), report bugs or UX issues
4. **Low-risk contributions:** Docs updates, test additions, marketing ideas

### Gradual Involvement
- **Week 1-2:** Quick wins (docs, bug reports, social media drafts)
- **Week 3-4:** Small contributions (bug fixes, tweet campaigns, Discord setup)
- **Month 2+:** Larger projects (features, X bot automation, partnership outreach)

### Validation Resources
- **SP1 Prover benchmarks:** 8.997s avg proof time, 52.89 tx/min throughput ([Whitepaper v2.4](WHITEPAPER.md))
- **Test suite:** 755+ tests across Solidity, CosmWasm, and integration suites with 85%+ coverage on Phase 1 audit contracts
- **Roadmap transparency:** See [WHITEPAPER.md Section 12](WHITEPAPER.md) for phase milestones and [Audit Readiness](docs/AUDIT_GRANT_READINESS.md) for current status

### Open-Source, Not Hiring (Yet)
This is a **bootstrapped project** with no immediate funding for hires. Contributions are:
- **Voluntary** (open-source collaboration)
- **Rewarded post-launch** (XF tokens, veXF governance roles—especially for marketing/community impact)
- **Flexible commitment** (contribute as much or little as you like)

If the project gains traction (e.g., $5M TVL, governance approval), active contributors will be first in line for paid roles (dev, marketing, community manager).

---

## 🔍 Focus Areas for Contributors

### 1. Security & Auditing (Technical)
**Priority:** High
- Review [ZKVerifierSP1.sol](contracts/core/ZKVerifierSP1.sol) and [CoreRevenueSplitter.sol](contracts/core/CoreRevenueSplitter.sol) for vulnerabilities
- Validate SP1 proof logic in [services/sp1-prover/host/src/main.rs](services/sp1-prover/host/src/main.rs)
- Add fuzz tests for edge cases (see `test/security/ContractFuzz.test.cjs` for examples)
- Help prep for CertiK audit (Q2 2026) — see [Audit Readiness Checklist](docs/AUDIT_GRANT_READINESS.md)

### 2. Automation (Technical + Marketing)
**Priority:** High (Phase 1 goal)
- Build monitoring bots on Theta Edge Cloud
- Create yield optimizer for automated LST routing
- **Implement X/Twitter bot** for user engagement (auto-replies, metrics posts)
- **Develop feedback analyzers** for sentiment tracking (Discord, X mentions)
- **Chatbot for Discord**: Answer FAQs, onboard new users

### 3. Marketing & Community Growth (Non-Technical)
**Priority:** High (Phase 1: User Engagement)
- **Social Media Campaigns**: Draft X posts, create memes, schedule content
- **Content Creation**: Write blog posts (Medium, Mirror), create explainer videos
- **Partnership Outreach**: Identify and contact Theta/Cosmos projects for collabs
- **Community Building**: Set up Discord server, host weekly AMAs, manage user onboarding
- **Growth Hacking**: Brainstorm viral tactics, analyze competitor strategies (LayerZero, Wormhole)
- **User Feedback**: Analyze beta tester sentiment, improve chatbot prompts

### 4. UX & Frontend (Technical)
**Priority:** Medium
- Polish cyberpunk neon theme (Tailwind + glassmorphism)
- Add reverse bridge UI (burn TFUEL flow)
- Improve mobile responsiveness
- Build governance dashboard (veXF voting)

### 5. Multi-Chain Expansion (Technical)
**Priority:** Low (Post-mainnet)
- Research bridges to Osmosis, Cosmos Hub
- Prototype Solana integration (requires new ZK circuit)
- Analyze gas costs for other L1s

---

## 🤝 Code of Conduct

We follow the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

**Key Principles:**
- **Be respectful:** Value diverse perspectives, assume good intentions
- **Be inclusive:** Welcome contributors of all skill levels
- **Be constructive:** Provide actionable feedback, not just criticism
- **Be collaborative:** Focus on what's best for the protocol

**Unacceptable Behavior:**
- Harassment, discrimination, or personal attacks
- Spamming or promoting unrelated projects
- Sharing vulnerabilities publicly before responsible disclosure

**Reporting:** Email violations to **conduct@xfuel.app** (confidential).

---

## 🏆 Rewards and Recognition

### Immediate Recognition
- Listed in [README.md](README.md) contributor credits
- Mentioned in release notes for significant contributions
- Invited to governance discussions (Discord/Forum)
- Shoutouts on X/Twitter for impactful marketing/community work

### Post-Launch Rewards (Mainnet)
- **XF tokens:** Allocated based on contribution impact—**especially for marketing/community growth** (reviewed quarterly)
- **veXF roles:** Active contributors eligible for governance positions (voting on LP allocation, fee structure)
- **Revenue share:** Top contributors may receive protocol fee share (30/30/25/15 split to BBB/LP/veXF/Treasury)
- **Marketing bonuses:** Contributors who drive measurable growth (e.g., +1K X followers, +$500K TVL) get bonus XF allocations

### Bug Bounty Program (Phase D)
- Up to **$500K** for critical vulnerabilities (via Immunefi)
- Rewards for valid bug reports (severity-based tiers)
- Hall of fame for security researchers

---

## 📞 Contact & Support

### Questions?
- **GitHub Issues:** Bug reports, feature requests
- **GitHub Discussions:** General questions, brainstorming
- **Discord:** Real-time chat (link coming soon)
- **X/Twitter:** [@xfuel_protocol](https://twitter.com/xfuel_protocol)

### Technical Support
- Review [WHITEPAPER.md](WHITEPAPER.md) for architecture details
- Check [docs/](docs/) folder for guides
- Ask in issues with `question` label

### Security
**DO NOT** report vulnerabilities publicly. Email: **security@xfuel.app**

---

## 📚 Additional Resources

**For New Contributors:**
- [README.md](README.md) - Project overview
- [WHITEPAPER.md](WHITEPAPER.md) - Technical architecture
- [docs/ZK_BRIDGE_IMPLEMENTATION.md](docs/ZK_BRIDGE_IMPLEMENTATION.md) - ZK proof details

**For Developers:**
- [Backend Setup Guide](services/gateway/README.md)
- [SP1 Prover Deployment](services/sp1-prover/DEPLOY_ON_EDGECLOUD.md)
- [Mock Testing Plan](MOCK_TESTING_PLAN.md)

**For Governance:**
- [Audit & Grant Readiness](docs/AUDIT_GRANT_READINESS.md) - CertiK Phase 1 preparation
- [Roadmap](WHITEPAPER.md) - Phase 1–6 milestones (Section 12)

---

## ✨ Thank You!

Every contribution—code, marketing, docs, reviews, or bug reports—helps make XFuel Protocol more secure and accessible. Whether you're a ZK expert, a social media wizard, or a curious newcomer, your perspective is valuable.

**No contribution is too small:** A single tweet, a typo fix, or a Discord suggestion can have massive impact.

**Welcome to the future of trustless cross-chain liquidity.** 🚀⚡

---

**Questions about contributing?** Email: **contribute@xfuel.app**

**Last Updated:** March 2026 (v2.4 - Hybrid Theta-Centric Architecture)
