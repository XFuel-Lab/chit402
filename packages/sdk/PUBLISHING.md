# Publishing `xfuel-sdk` to npm

Verified publish-ready (2026-06-29): `npm run build` ✓, `npm test` 25/25 ✓,
`npm pack --dry-run` ships only `dist/` + `README.md` + `LICENSE` + `package.json`
(~14 kB). `exports`/`types` configured, `files` whitelist, `prepublishOnly` runs
build + tests.

**Confirmed decisions:**
- **Name:** `xfuel-sdk` (unscoped — confirmed available; matches `npm install
  xfuel-sdk` in `AGENTS.md`, README, and the skills).
- **License:** Apache-2.0 (aligned with the repo root; `packages/sdk/LICENSE` bundled).

## One-time setup

1. Create an npm account (https://www.npmjs.com/signup) if you don't have one.
2. Enable 2FA (npm requires it for publishing by default) — you'll be prompted
   for an OTP during `npm publish`.
3. (Optional) Re-confirm the name is still free right before publishing:

   ```bash
   npm view xfuel-sdk        # 404 = still available
   ```

   `publishConfig.access` is already `public`.

## Publish (preferred — security key / WebAuthn)

How `xfuel-sdk` 0.1.0 / 0.2.0 were shipped. Opens a browser for npm login +
hardware security key (or passkey). Does **not** rely on a classic `~/.npmrc`
token (those expire and return `E401`).

```powershell
cd packages/sdk
npm publish --access public --auth-type=web
```

```bash
cd packages/sdk
npm publish --access public --auth-type=web
```

`prepublishOnly` runs `build` + `test` first. Complete the browser prompt, then
verify: https://www.npmjs.com/package/xfuel-sdk

## Alternate: classic login + OTP

```bash
cd packages/sdk
npm login                       # interactive; stores token
npm publish --access public --otp=XXXXXX   # authenticator code if 2FA requires it
```

## CI publishing (optional — not wired today)

There is **no** GitHub Actions publish workflow yet. If you add one, use an
**automation** token (npm → Access Tokens → Granular/Automation) as
`NODE_AUTH_TOKEN` (no OTP / no security-key prompt):

```bash
npm publish --access public --provenance
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
