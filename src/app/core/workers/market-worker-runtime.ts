import { MarketMetrics } from '../models/market-metrics.model';
import { MarketUpdate } from '../models/market-update.model';
import { MarketAggregator } from '../utils/market-aggregator';
import { LatestSnapshotPublisher } from '../utils/latest-snapshot-publisher';
import {
  MarketWorkerRequest,
  MarketWorkerResponse
} from './market-worker-messages';

export interface MarketWasmGenerator {
  generate_batch(count: number): string;
  get_instruments(): string;
  free(): void;
}

export interface MarketWasmBindings {
  default(): Promise<unknown>;
  MarketGenerator: new (
    instrumentCount: number,
    seed: number
  ) => MarketWasmGenerator;
}

export interface MarketWorkerScope {
  postMessage(message: MarketWorkerResponse): void;
  close(): void;
}

export type MarketWasmLoader = (url: string) => Promise<MarketWasmBindings>;

export function createMarketWorkerRuntime(
  workerScope: MarketWorkerScope,
  loadWasm: MarketWasmLoader
): (request: MarketWorkerRequest) => Promise<void> {
  let generator: MarketWasmGenerator | null = null;
  let aggregator: MarketAggregator | null = null;
  let activeRunId = 0;
  let generation = 0;
  let lastCommandId = 0;
  let nextSnapshotId = 0;
  let batchInterval = 500;
  let updatesPerBatch = 100;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  let disposed = false;

  const snapshotPublisher = new LatestSnapshotPublisher<MarketMetrics[]>(
    (metrics) => {
      if (!disposed) {
        workerScope.postMessage({
          type: 'BATCH',
          runId: activeRunId,
          snapshotId: ++nextSnapshotId,
          metrics
        });
      }
    },
    100
  );

  function isMarketUpdate(value: unknown): value is MarketUpdate {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const update = value as Record<string, unknown>;
    const price = update['priceCents'];
    const tradeQuantity = update['tradeQuantity'];
    const bid = update['bidCents'];
    const ask = update['askCents'];
    const bidQuantity = update['bidQuantity'];
    const askQuantity = update['askQuantity'];

    return typeof update['instrument'] === 'string' &&
      update['instrument'].length > 0 &&
      typeof price === 'number' &&
      Number.isSafeInteger(price) &&
      price > 0 &&
      typeof tradeQuantity === 'number' &&
      Number.isSafeInteger(tradeQuantity) &&
      tradeQuantity > 0 &&
      typeof bid === 'number' &&
      Number.isSafeInteger(bid) &&
      bid > 0 &&
      typeof ask === 'number' &&
      Number.isSafeInteger(ask) &&
      bid < ask &&
      (price === bid || price === ask) &&
      typeof bidQuantity === 'number' &&
      Number.isSafeInteger(bidQuantity) &&
      bidQuantity >= 0 &&
      typeof askQuantity === 'number' &&
      Number.isSafeInteger(askQuantity) &&
      askQuantity >= 0;
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function releaseGenerator(): void {
    clearTimer();
    snapshotPublisher.reset();
    generator?.free();
    generator = null;
    aggregator = null;
  }

  function postError(runId: number, error: unknown): void {
    releaseGenerator();
    workerScope.postMessage({
      type: 'ERROR',
      runId,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  function scheduleBatch(runId: number): void {
    if (disposed || paused || runId !== activeRunId || !generator || !aggregator) {
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      if (disposed || paused || runId !== activeRunId || !generator || !aggregator) {
        return;
      }

      try {
        const updates = JSON.parse(
          generator.generate_batch(updatesPerBatch)
        ) as unknown;

        if (!Array.isArray(updates)) {
          throw new Error('Wasm generator returned a batch that is not an array');
        }

        if (!updates.every(isMarketUpdate)) {
          throw new Error('Wasm generator returned an invalid market update');
        }

        aggregator.processBatch(updates);
        snapshotPublisher.publish(() => aggregator?.getMetrics() ?? []);
        scheduleBatch(runId);
      } catch (error) {
        postError(runId, error);
      }
    }, batchInterval);
  }

  async function start(
    request: Extract<MarketWorkerRequest, { type: 'START' }>
  ): Promise<void> {
    const startGeneration = ++generation;
    activeRunId = request.runId;
    lastCommandId = 0;
    nextSnapshotId = 0;
    disposed = false;
    paused = false;
    releaseGenerator();
    batchInterval = request.settings.batchInterval;
    updatesPerBatch = request.settings.updatesPerBatch;

    let candidateGenerator: MarketWasmGenerator | null = null;
    try {
      const bindings = await loadWasm(request.wasmModuleUrl);
      if (disposed || startGeneration !== generation) {
        return;
      }

      candidateGenerator = new bindings.MarketGenerator(
        request.settings.instrumentCount,
        request.seed
      );
      const symbols = JSON.parse(candidateGenerator.get_instruments()) as unknown;
      if (
        !Array.isArray(symbols) ||
        !symbols.every((symbol): symbol is string => typeof symbol === 'string')
      ) {
        throw new Error('Wasm generator returned invalid instrument symbols');
      }

      generator = candidateGenerator;
      candidateGenerator = null;
      aggregator = new MarketAggregator(symbols);
      workerScope.postMessage({
        type: 'READY',
        runId: request.runId,
        snapshotId: nextSnapshotId,
        status: paused ? 'paused' : 'running',
        metrics: aggregator.getMetrics()
      });
      scheduleBatch(request.runId);
    } catch (error) {
      candidateGenerator?.free();
      if (!disposed && startGeneration === generation) {
        postError(request.runId, error);
      }
    }
  }

  return async (request): Promise<void> => {
    if (request.type === 'DISPOSE') {
      if (disposed) {
        return;
      }
      generation += 1;
      disposed = true;
      activeRunId = request.runId;
      releaseGenerator();
      workerScope.close();
      return;
    }

    if (request.type === 'START') {
      if (!disposed) {
        await start(request);
      }
      return;
    }

    if (disposed || request.runId !== activeRunId) {
      return;
    }

    if (request.type === 'PAUSE') {
      if (
        !Number.isSafeInteger(request.commandId) ||
        request.commandId <= lastCommandId
      ) {
        return;
      }
      lastCommandId = request.commandId;
      paused = true;
      clearTimer();
      snapshotPublisher.flush();
      workerScope.postMessage({
        type: 'PAUSED',
        runId: request.runId,
        commandId: request.commandId
      });
      return;
    }

    if (request.type === 'RESUME') {
      if (
        !Number.isSafeInteger(request.commandId) ||
        request.commandId <= lastCommandId
      ) {
        return;
      }
      lastCommandId = request.commandId;
      paused = false;
      scheduleBatch(request.runId);
      workerScope.postMessage({
        type: 'RESUMED',
        runId: request.runId,
        commandId: request.commandId
      });
    }
  };
}
