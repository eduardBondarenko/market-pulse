/// <reference lib="webworker" />

import {
  createMarketWorkerRuntime,
  MarketWasmBindings
} from './market-worker-runtime';
import {
  MarketWorkerRequest,
  MarketWorkerResponse
} from './market-worker-messages';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MarketWorkerRequest>) => void) | null;
  postMessage(message: MarketWorkerResponse): void;
  close(): void;
};

let wasmBindingsPromise: Promise<MarketWasmBindings> | null = null;
let wasmModuleUrl: string | null = null;

async function loadWasm(url: string): Promise<MarketWasmBindings> {
  if (wasmBindingsPromise && wasmModuleUrl === url) {
    return wasmBindingsPromise;
  }

  wasmModuleUrl = url;
  wasmBindingsPromise = (async () => {
    const bindings = await import(url) as unknown as MarketWasmBindings;
    await bindings.default();
    return bindings;
  })();

  try {
    return await wasmBindingsPromise;
  } catch (error) {
    wasmBindingsPromise = null;
    wasmModuleUrl = null;
    throw error;
  }
}

const handleRequest = createMarketWorkerRuntime(workerScope, loadWasm);

workerScope.onmessage = ({ data: request }): void => {
  void handleRequest(request);
};
