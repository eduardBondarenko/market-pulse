import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProducerSettings } from '../models/producer-settings.model';
import {
  MarketWasmBindings,
  MarketWasmGenerator,
  MarketWorkerScope,
  createMarketWorkerRuntime
} from './market-worker-runtime';
import {
  MarketWorkerRequest,
  MarketWorkerResponse
} from './market-worker-messages';

const settings: ProducerSettings = {
  instrumentCount: 1,
  updatesPerBatch: 1,
  batchInterval: 50
};

const startRequest = (
  runId: number
): Extract<MarketWorkerRequest, { type: 'START' }> => ({
  type: 'START',
  runId,
  settings,
  seed: runId,
  wasmModuleUrl: `wasm-${runId}`
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(
  loadWasm: (url: string) => Promise<MarketWasmBindings>
) {
  const messages: MarketWorkerResponse[] = [];
  const scope: MarketWorkerScope & { closeCount: number } = {
    closeCount: 0,
    postMessage: (message) => messages.push(message),
    close: () => {
      scope.closeCount += 1;
    }
  };
  const handle = createMarketWorkerRuntime(scope, loadWasm);
  return { handle, messages, scope };
}

function createBindings(options?: {
  getInstruments?: () => string;
  generateBatch?: (count: number, invocation: number) => string;
  free?: () => void;
  onConstruct?: (instrumentCount: number, seed: number) => void;
}): MarketWasmBindings {
  return {
    default: async () => undefined,
    MarketGenerator: class implements MarketWasmGenerator {
      private generationCall = 0;

      constructor(instrumentCount: number, seed: number) {
        options?.onConstruct?.(instrumentCount, seed);
      }
      generate_batch(count: number): string {
        this.generationCall += 1;
        return options?.generateBatch?.(count, this.generationCall) ??
          JSON.stringify([{
            instrument: 'ALFA',
            priceCents: 10_000 + this.generationCall,
            tradeQuantity: 1,
            bidCents: 9_999 + this.generationCall,
            askCents: 10_000 + this.generationCall,
            bidQuantity: 1,
            askQuantity: 1
          }]);
      }
      get_instruments(): string {
        return options?.getInstruments?.() ?? '["ALFA"]';
      }
      free(): void {
        options?.free?.();
      }
    }
  };
}

describe('Market Worker runtime lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
  });

  it('PAUSE stops generation; RESUME continues after one interval without catch-up batches', async () => {
    const generateBatch = vi.fn((_count: number, call: number) => JSON.stringify([{
      instrument: 'ALFA',
      priceCents: 10_000 + call,
      tradeQuantity: 1,
      bidCents: 9_999 + call,
      askCents: 10_000 + call,
      bidQuantity: 1,
      askQuantity: 1
    }]));
    const { handle } = createHarness(async () => createBindings({ generateBatch }));

    await handle(startRequest(1));
    await vi.advanceTimersByTimeAsync(50);
    expect(generateBatch).toHaveBeenCalledTimes(1);

    await handle({ type: 'PAUSE', runId: 1, commandId: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(generateBatch).toHaveBeenCalledTimes(1);

    await handle({ type: 'RESUME', runId: 1, commandId: 2 });
    await vi.advanceTimersByTimeAsync(49);
    expect(generateBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(generateBatch).toHaveBeenCalledTimes(2);
    expect(generateBatch.mock.calls.map(([count, call]) => [count, call])).toEqual([
      [1, 1],
      [1, 2]
    ]);
  });

  it('DISPOSE clears generation and pending snapshot timers and releases the generator', async () => {
    const free = vi.fn();
    const { handle, messages, scope } = createHarness(async () =>
      createBindings({ free })
    );

    await handle(startRequest(1));
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(2);

    await handle({ type: 'DISPOSE', runId: 1 });
    expect(free).toHaveBeenCalledTimes(1);
    expect(scope.closeCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    const messageCountAfterDispose = messages.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages).toHaveLength(messageCountAfterDispose);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not activate a prior asynchronous START after a newer run starts', async () => {
    const previousLoad = deferred<MarketWasmBindings>();
    const currentLoad = deferred<MarketWasmBindings>();
    const constructedRuns: Array<{ instrumentCount: number; seed: number }> = [];
    const loadWasm = vi.fn((url: string) =>
      url === 'wasm-1' ? previousLoad.promise : currentLoad.promise
    );
    const { handle, messages } = createHarness(loadWasm);

    const previousStart = handle(startRequest(1));
    const currentStart = handle(startRequest(2));
    currentLoad.resolve(createBindings({
      onConstruct: (instrumentCount, seed) =>
        constructedRuns.push({ instrumentCount, seed })
    }));
    await currentStart;

    previousLoad.resolve(createBindings({
      onConstruct: (instrumentCount, seed) =>
        constructedRuns.push({ instrumentCount, seed })
    }));
    await previousStart;

    expect(messages.filter((message) => message.type === 'READY')).toEqual([
      expect.objectContaining({ type: 'READY', runId: 2 })
    ]);
    expect(constructedRuns).toEqual([{ instrumentCount: 1, seed: 2 }]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not revive a pending Wasm initialization after DISPOSE', async () => {
    const initialization = deferred<MarketWasmBindings>();
    const constructor = vi.fn();
    const { handle, messages, scope } = createHarness(() => initialization.promise);

    const startPromise = handle(startRequest(1));
    await handle({ type: 'DISPOSE', runId: 1 });
    initialization.resolve(createBindings({ onConstruct: constructor }));
    await startPromise;

    expect(constructor).not.toHaveBeenCalled();
    expect(messages).toEqual([]);
    expect(scope.closeCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers from failed initialization when a new START is received', async () => {
    const failed = new Error('Wasm module failed to initialize');
    const loadWasm = vi.fn()
      .mockRejectedValueOnce(failed)
      .mockResolvedValueOnce(createBindings());
    const { handle, messages } = createHarness(loadWasm);

    await handle(startRequest(1));
    expect(messages).toContainEqual({
      type: 'ERROR',
      runId: 1,
      error: 'Wasm module failed to initialize'
    });
    expect(vi.getTimerCount()).toBe(0);

    await handle(startRequest(2));
    expect(messages.at(-1)).toMatchObject({
      type: 'READY',
      runId: 2,
      status: 'running'
    });
    expect(loadWasm).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('repeated START, PAUSE, RESUME and DISPOSE leave only one generation loop', async () => {
    const free = vi.fn();
    const generateBatch = vi.fn((_count: number, call: number) => JSON.stringify([{
      instrument: 'ALFA',
      priceCents: 10_000 + call,
      tradeQuantity: 1,
      bidCents: 9_999 + call,
      askCents: 10_000 + call,
      bidQuantity: 1,
      askQuantity: 1
    }]));
    const { handle, messages } = createHarness(async () =>
      createBindings({ free, generateBatch })
    );

    await handle(startRequest(1));
    await handle({ type: 'PAUSE', runId: 1, commandId: 1 });
    await handle({ type: 'RESUME', runId: 1, commandId: 2 });
    await handle(startRequest(2));

    expect(free).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await handle({ type: 'PAUSE', runId: 2, commandId: 1 });
    await handle({ type: 'PAUSE', runId: 2, commandId: 1 });
    expect(messages.filter((message) =>
      message.type === 'PAUSED' && message.runId === 2
    )).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    await handle({ type: 'RESUME', runId: 2, commandId: 1 });
    expect(messages.filter((message) =>
      message.type === 'RESUMED' && message.runId === 2
    )).toHaveLength(0);
    await handle({ type: 'RESUME', runId: 2, commandId: 2 });
    expect(messages.filter((message) =>
      message.type === 'RESUMED' && message.runId === 2
    )).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(generateBatch).toHaveBeenCalledTimes(2);

    await handle({ type: 'DISPOSE', runId: 2 });
    await handle({ type: 'DISPOSE', runId: 2 });
    expect(free).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(generateBatch).toHaveBeenCalledTimes(2);
  });

  it('reports invalid generator initialization and frees an unusable generator', async () => {
    const free = vi.fn();
    const { handle, messages } = createHarness(async () =>
      createBindings({
        free,
        getInstruments: () => 'not-json'
      })
    );

    await handle(startRequest(1));

    expect(free).toHaveBeenCalledTimes(1);
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'ERROR',
      runId: 1,
      error: expect.stringContaining('JSON')
    }));
    expect(vi.getTimerCount()).toBe(0);
  });
});
