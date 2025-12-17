# Contributing to XFUEL Protocol

## Development Workflow

### 1. Create a Feature Branch
```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes
- Write code
- Test locally (`npm run dev`)
- Run tests (`npm test`, `npm run test:contracts`)

### 3. Commit Your Changes
```bash
git add .
git commit -m "feat: your feature description"
```

### 4. Push and Create Pull Request
```bash
git push origin feature/your-feature-name
```

Then on GitHub:
1. Go to your repository
2. Click "Compare & pull request"
3. Fill out the PR description
4. Wait for CI to pass (tests run automatically)
5. Request review if needed
6. Merge when approved

### 5. Merge via GitHub UI
- Use "Squash and merge" or "Create a merge commit"
- Delete the feature branch after merging

## Branch Naming
- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates

## Commit Messages
Follow conventional commits:
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring
- `docs:` - Documentation
- `test:` - Tests
- `chore:` - Maintenance

## CI/CD
- All PRs automatically run:
  - Jest unit tests
  - Hardhat contract tests
  - Cypress E2E tests
- PRs must pass all tests before merging

