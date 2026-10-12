# Market Pulse WebAssembly market generator

This crate implements a deterministic, stateful market data generator for the
Market Pulse application. Its JSON updates use the same field names as
`MarketUpdate` in `src/app/core/models/market-update.model.ts`.

## Prerequisites

- Rust and Cargo
- `wasm-pack`
- The `wasm32-unknown-unknown` Rust target (install with
  `rustup target add wasm32-unknown-unknown`)

## Test

From the project root:

```sh
cargo test --manifest-path wasm/Cargo.toml
```

## Build for the web

From the project root:

```sh
wasm-pack build wasm --target web
```

The generated ES module and WebAssembly file are written to `wasm/pkg/`.

## API and Angular integration

`MarketGenerator::new(instrumentCount, seed)` accepts an instrument count from
1 to 50 and an unsigned 32-bit numeric seed. `generate_batch(count)` accepts
1–1000 and returns a JSON string containing exactly that many updates.
`get_instruments()` returns a JSON string containing the stable instrument
symbols. Invalid counts return JavaScript errors with a descriptive message.

The generator can be loaded later from an Angular application without adding
generator logic to TypeScript:

```ts
import init, { MarketGenerator } from '../../wasm/pkg/market_pulse_wasm.js';

await init();
const generator = new MarketGenerator(5, 1234);
const instruments: string[] = JSON.parse(generator.get_instruments());
const updates: MarketUpdate[] = JSON.parse(generator.generate_batch(100));
```

Adjust the relative import to match the consuming TypeScript file. The returned
JSON strings are parsed in TypeScript to produce values compatible with
`MarketUpdate`. This crate intentionally does not implement timers, Web Workers,
or Angular integration.
