# Publishing `xfuel-sdk` to npm

Verified publish-ready (2026-06-29): `npm run build` ✓, `npm test` 25/25 ✓,
`npm pack --dry-run` ships only `dist/` + `README.md` + `LICENSE` + `package.json`
(~14 kB). `exports`/`types` configured, `files` whitelist, `prepublishOnly` runs
build + tests.

**Confirmed decisions:**
- **Name:** `xfuel-sdk` (unscoped — confirmed available; matches `npm install
  xfuel-sdk` in `AGENTS.md`, README, and the skills).
- **License:** Apache-2.0 (aligned with the repo root; `sdk/js/LICENSE` bundled).

## One-time setup

1. Create an npm account (https://www.npmjs.com/signup) if you don't have one.
2. Enable 2FA (npm requires it for publishing by default) — you'll be prompted
   for an OTP during `npm publish`.
3. (Optional) Re-confirm the name is still free right before publishing:

   ```bash
   npm view xfuel-sdk        # 404 = still available
   ```

   `publishConfig.access` is already `public`.

## Publish

```bash
cd sdk/js
npm login                       # interactive; stores token
npm version patch               # or minor/major — bumps version + git tag
npm publish                     # runs prepublishOnly (build + test) first
```

For CI publishing, create an **automation token** (npm → Access Tokens →
Granular/Automation) and set it as `NODE_AUTH_TOKEN`, then:

```bash
npm publish --provenance        # if publishing from GitHub Actions
```

## Verify

```bash
npm view xfuel-sdk version
npm pack --dry-run              # inspect exactly what ships (should be dist/ + README + package.json)
```

## Versioning policy

- `0.x` while the M2M API surface is still moving.
- Bump **minor** when adding endpoints/fields (e.g. the new `callback_url`,
  `proof_system` task params).
- Bump **major** on breaking signature changes.

## What ships

Only `dist/`, `README.md`, and `LICENSE` (per the `files` whitelist). Tests and
sources are excluded. Confirm with `npm pack --dry-run`.
