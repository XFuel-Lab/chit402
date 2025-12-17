# XFUEL Protocol

Sub-4s institutional-grade settlement rail: Theta EdgeCloud GPU/video revenue → auto-compounding Cosmos LSTs

## Features

- 🚀 Built with Vite 5.0.0, React 18, TypeScript, and Tailwind CSS
- 🔌 Theta Wallet integration with balance display
- 💱 TFUEL swap interface with MAX button
- ⚡ Quick swap presets: 25% → stkXPRT, 50% → stkATOM, 100% → pSTAKE BTC
- 📊 Live indicators: finality, gas, price impact, Chainalysis safety
- 🎨 Dark cyberpunk theme with purple/blue neon gradients
- 📱 Fully responsive mobile design

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

4. Preview production build:
```bash
npm run preview
```

## Unified Web + Mobile Product

This repo contains both the **web app** (investor site) and the **Expo mobile app** (investor demo) in one place.

- **Web app (Vite, deployed on Vercel)**
  - Run locally:
    ```bash
    npm run dev:web
    ```
  - Build for production / Vercel:
    ```bash
    npm run build:web
    ```

- **Mobile app (Expo + EAS Update, in `edgefarm-mobile/`)**
  - Run in Expo Go (local dev):
    ```bash
    npm run dev:mobile
    ```
  - Publish / refresh the investor demo build (EAS Update on `preview` branch):
    ```bash
    npm run eas:update:preview
    ```

## Investor Demo Links

These are the links you can share with investors to explore the current mock:

- **Mobile app (Expo Go, hosted via EAS Update)**  
  Open this link on a device with **Expo Go** installed, or scan the QR on the page:  
  `https://expo.dev/accounts/xfuel/projects/edgefarm-mobile/updates/227ac41f-0628-40f7-bb60-c29d615be007`

- **Web app (Vercel)**  
  Production preview for the current mock (served from the `main` branch):  
  `https://xfuel-protocol-v2-m1v9p0laq-chris-hayes-projects-ffe91919.vercel.app/`

### Investor demo checklist

- **Web URL (browser)**: deploy the latest `dist` to Vercel from this repo. Share the resulting `https://...vercel.app` link.
- **Mobile app (Expo Go)**: run `npm run eas:update:preview` and share the URL / QR code that the command prints.

Use these two links as the **single source of truth** for external demos so the app and site always match.

## Project Structure

```
xfuel-protocol/
├── src/
│   ├── App.tsx          # Main application component
│   ├── main.tsx         # React entry point
│   └── index.css        # Tailwind CSS styles
├── index.html           # HTML entry point
├── vite.config.ts       # Vite configuration
├── tsconfig.json        # TypeScript configuration
├── tailwind.config.js   # Tailwind CSS configuration
└── package.json         # Dependencies and scripts
```

## Professional Workflow (XFUEL)

To keep this codebase production-grade, follow this workflow for **all changes**:

1. **Never work directly on `main`**
   - Create a new branch for every change:
     - Features: `feature/[short-name]`
     - Fixes: `fix/[short-name]`
2. **Run tests after any code change**
   - Unit/integration tests:
     ```bash
     npm test
     ```
   - E2E tests (local dev, interactive Cypress runner):
     ```bash
     npm run test:e2e
     ```
   - For automation/CI, prefer the headless variant:
     ```bash
     npm run test:e2e:headless
     ```
3. **Only commit if all tests pass**
   - Fix failing tests before committing.
4. **Push branches and use PRs**
   - Push your branch and open a Pull Request against `main`.
   - When work is ready, communicate it as:  
     `Ready on branch feature/[name] — open PR to merge when good`
5. **No direct merges to `main` without explicit approval**
   - `main` is protected; only merge via reviewed/approved PRs.

## Tech Stack

- **Vite 5.0.0** - Next-generation frontend tooling
- **React 18** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first CSS framework

## White Paper

You can download the XFuel protocol white paper here:

- `https://github.com/XFuel-Lab/xfuel-protocol/raw/main/XFuel%20White%20Paper.pdf`
