# Market Pulse

Market Pulse is a responsive Angular dashboard for viewing a stream of
simulated financial-market updates. A Rust/WebAssembly generator produces
events in a Web Worker; the Angular application displays their cumulative
metrics without doing generation work on the UI thread.

## Tech stack

- Angular 21 and TypeScript
- Angular Signals and `OnPush` change detection
- Angular Reactive Forms
- Angular CDK Virtual Scroll
- Rust, `wasm-bindgen`, and `wasm-pack`
- Web Worker
- Vitest

## Features

- Live last-price, bid/ask spread, cumulative volume, VWAP, and order-book
  imbalance metrics.
- Settings form with validation for instrument count (1–50), updates per batch
  (1–1,000), and batch interval (50–2,000 ms); changes take effect with Apply.
- Pause and Resume controls for the market data producer.
- Responsive desktop, tablet, and mobile dashboard layouts.
- Virtualized instrument rows and a sticky desktop table header.
- Status and settings notifications.

## Architecture

```text
Rust/Wasm generator
        │ market updates (JSON)
        ▼
Web Worker ── validates and schedules batches
        ▼
MarketAggregator ── processes every update and retains cumulative metrics
        ▼
Aggregated snapshots ── coalesced to about one every 100 ms when needed
        ▼
MarketService Signals
        ▼
Angular Dashboard
```

The Rust generator produces market events, not dashboard metrics. The Worker
passes each generated update to `MarketAggregator`; the aggregator maintains
per-instrument cumulative state without retaining trade history. Snapshot
coalescing limits UI messaging when batches arrive frequently, while all
updates continue to contribute to the cumulative metrics.

## Prerequisites

- Node.js supported by Angular CLI 21: `^20.19.0`, `^22.12.0`, or `>=24.0.0`.
- npm compatible with the project lockfile; `package.json` declares npm 11.17.0.
- A Rust stable toolchain with Cargo. The crate uses Rust edition 2024.
- The `wasm32-unknown-unknown` target and `wasm-pack`.

Install the Rust target and, if needed, wasm-pack:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

## Setup and run

From the repository root:

```sh
npm ci
wasm-pack build wasm --target web
npm start
```

Open the local URL printed by Angular CLI (normally `http://localhost:4200/`).

`wasm-pack build wasm --target web` writes the generated JavaScript bindings and
`.wasm` binary to `wasm/pkg/`. Angular's asset configuration copies those
`*.js` and `*.wasm` files to `assets/market-pulse-wasm` in the application
build, where the Worker loads the bindings.

Create an optimized production build with:

```sh
npm run build -- --configuration production
```

Build the Wasm package before building or serving the app so the expected files
exist in `wasm/pkg/`.

## Cloudflare Workers Builds deployment

The `market-pulse` Worker is intended to use Cloudflare Workers Builds with the
GitHub repository `eduardBondarenko/market-pulse` and production branch `main`.
Connect or verify that repository and branch under the Worker’s **Settings >
Build**. Workers Builds currently uses an Ubuntu 24.04 x86_64 image with Node.js
and npm, but its documented preinstalled tooling does not include Rust,
`wasm32-unknown-unknown`, or `wasm-pack`. The build script installs Rust stable,
adds the Wasm target, and installs the pinned `wasm-pack` 0.15.0 before running
the test and build steps.

In the Worker’s **Settings > Build**, configure:

| Setting | Command |
| --- | --- |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npx wrangler deploy` |

Workers Builds installs the npm dependencies from the repository manifest and
lockfile. The build command runs Rust tests, Angular/Vitest tests, builds the
Wasm package, and creates the production Angular output. Wrangler then deploys
the Worker configuration and the generated static assets. The `wrangler.jsonc`
configuration enables SPA fallback so direct navigation to routes such as
`/dashboard` and `/settings` serves the Angular application shell.

To reproduce the sequence locally on Linux with Node.js, npm, curl, and
build-essential available, run:

```sh
npm ci
npm run build:cloudflare
npx wrangler deploy
```

The last command publishes to Cloudflare and is not part of the build script.
For configuration validation without deployment, run:

```sh
npx wrangler deploy --dry-run
```

Cloudflare documentation: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/),
[Build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/),
[Static Assets SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/),
and [Wrangler deployment](https://developers.cloudflare.com/workers/wrangler/commands/).

## Tests

Run the Angular/Vitest suite and the Rust tests from the repository root:

```sh
npm test -- --watch=false
cargo test --manifest-path wasm/Cargo.toml
```

## Design decisions

- **Generate events in Wasm:** Rust owns deterministic seeded price and trade
  generation. TypeScript aggregates updates into application metrics.
- **Use a Web Worker:** generation, Wasm calls, and aggregation are isolated
  from UI rendering.
- **Signals and `OnPush`:** Signals expose market state reactively; Dashboard,
  Settings, and toast UI use `OnPush` change detection.
- **Coalesce snapshots, not trades:** the Worker processes every generated
  update, then publishes the latest cumulative state at most about once per
  100 ms when generation is faster.
- **Virtualize rows:** CDK Virtual Scroll renders the visible instrument rows
  and a buffer while keeping the configured row size fixed for each responsive
  layout.
- **Guard asynchronous state:** `runId` distinguishes producer runs,
  `commandId` matches Pause/Resume acknowledgements, and `snapshotId` rejects
  duplicate or out-of-order metric snapshots.

## Limitations and assumptions

- Market data is fictional and generated locally; there is no real exchange
  connection.
- Settings are held in application state and are not persisted across reloads.
- The dashboard is intended for a small configured set of instruments (up to
  50), not an unlimited market feed.
