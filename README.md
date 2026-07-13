<p align="center">
  <img src="docs/assets/hero-terminal.png" alt="HTTrack Cloner Skill terminal chameleon hero" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Redux0223/httrack-cloner-skill/actions/workflows/ci.yml"><img src="docs/assets/stat-tests.svg" alt="123 automated tests passing" width="32%"></a>
  <a href="SKILL.md"><img src="docs/assets/stat-stack.svg" alt="React 19 and TanStack Router stack" width="32%"></a>
  <a href="#quick-start"><img src="docs/assets/stat-delivery.svg" alt="Local-first project delivery" width="32%"></a>
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Give a coding agent an authorized URL. Get an editable local React project and an opened browser preview.</strong>
</p>

`httrack-cloner-skill` is a self-contained workflow for reconstructing authorized websites as local **React + TypeScript + TanStack Router** projects. It captures deployed files with HTTrack, recovers runtime assets, removes automatic external requests, builds the result, verifies it in a browser, and opens the local preview.

> [!IMPORTANT]
> Use this project only for websites and assets you are authorized to capture, modify, and redistribute.

## Showcase

<p align="center">
  <a href="docs/cases/httrack-cloner-showcase.mp4">
    <img src="docs/cases/httrack-cloner-showcase.gif" alt="Side-by-side comparison with the original website on the left and local React clone on the right" width="100%">
  </a>
</p>

<p align="center">
  <strong>Original website on the left · Local React clone on the right</strong><br>
  Synchronized Santioni Spirits and 2xA Studio comparisons. Click for the higher-quality MP4.
</p>

Captured website source and original third-party assets are not distributed in this repository.

## What it does

| Stage | Result |
| --- | --- |
| Capture | Host-scoped HTTrack mirror and asset inventory |
| Analyze | Routes, scripts, runtime assets, and interaction contracts |
| Reconstruct | React 19, TypeScript, Vite, and TanStack Router routes |
| Localize | Local media, fonts, workers, WASM, models, and textures |
| Verify | Typecheck, production build, route probes, and browser diagnostics |
| Deliver | Clean project directory and opened loopback preview |

<p align="center">
  <img src="docs/assets/pipeline.svg" alt="Terminal-style HTTrack cloning pipeline" width="100%">
</p>

## Quick start

```bash
git clone https://github.com/Redux0223/httrack-cloner-skill.git
cd httrack-cloner-skill
npm ci --prefix scripts

mkdir -p ~/.codex/skills
ln -s "$(pwd)" ~/.codex/skills/httrack-cloner-skill
```

Give your coding agent a URL:

```text
Use $httrack-cloner-skill on https://example.com/
```

Or run the deterministic entry point:

```bash
node scripts/run-url.mjs --url "https://example.com/" --authorized --depth 3
```

Resume a repair loop with:

```bash
node scripts/run-url.mjs --resume "/absolute/path/to/run"
```

## Requirements

- Node.js 20 or newer and npm
- HTTrack available on `PATH`
- Chromium dependencies for Playwright
- Network access to the authorized source during capture

```bash
# macOS
brew install httrack

# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y httrack

npx --prefix scripts playwright install chromium
```

## Output

```text
clone-runs/<host>-<timestamp>-<id>/
├── mirror/       # captured source and inventory
├── react/        # editable React deliverable
├── proof/        # browser evidence
└── .cloner/      # trace, state, and repair history
```

Complex production bundles may remain behind a sanitized local React adapter when an automatic idiomatic rewrite would change behavior. The generated reports distinguish project delivery from visual parity instead of claiming pixel-perfect output without evidence.

## Safety and limits

- Capture is host-scoped and requires `--authorized`.
- Automatic external runtime requests are blocked or reported.
- Live APIs require deterministic local replacements.
- Minified WebGL and canvas runtimes may need a local adapter.
- Authentication, CAPTCHA, DRM, paywalls, and access controls are out of scope.
- Generated authorization reports are technical evidence, not legal advice.

## Development

```bash
npm ci --prefix scripts
npm run validate
```

The suite contains 123 automated tests covering capture, assets, React conversion, TanStack routing, external request cleanup, browser proof, repair loops, and reproducible delivery.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Report security issues through [SECURITY.md](SECURITY.md).

## License

The Skill implementation is released under the [MIT License](LICENSE). Generated projects and captured assets retain their original ownership and licensing conditions.
