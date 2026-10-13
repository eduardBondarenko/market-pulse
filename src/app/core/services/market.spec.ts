import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketMetrics } from '../models/market-metrics.model';
import { ProducerSettings } from '../models/producer-settings.model';
import { MarketService } from './market';
import {
  MarketWorkerRequest,
  MarketWorkerResponse
} from '../workers/market-worker-messages';

class MockWorker {
  readonly requests: MarketWorkerRequest[] = [];
  private readonly listeners = new Map<
    string,
    EventListenerOrEventListenerObject
  >();
  terminated = false;

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  postMessage(message: MarketWorkerRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: MarketWorkerResponse): void {
    const listener = this.listeners.get('message');
    if (!listener) {
      return;
    }

    const event = new MessageEvent<MarketWorkerResponse>('message', {
      data: message
    });
    if (typeof listener === 'function') {
      listener(event);
    } else {
      listener.handleEvent(event);
    }
  }
}

const metric = (volume: number): MarketMetrics => ({
  instrument: 'ALFA',
  lastPriceCents: volume > 0 ? 10_000 : null,
  volume,
  totalPriceQuantity: volume * 10_000,
  bidCents: volume > 0 ? 9_999 : null,
  askCents: volume > 0 ? 10_000 : null,
  bidQuantity: volume > 0 ? 10 : null,
  askQuantity: volume > 0 ? 20 : null
});

describe('MarketService', () => {
  let service: MarketService;
  let worker: MockWorker;

  beforeEach(() => {
    vi.stubGlobal(
      'Worker',
      class extends MockWorker {
        constructor() {
          super();
          worker = this;
        }
      }
    );
    TestBed.configureTestingModule({});
    service = TestBed.inject(MarketService);
  });

  afterEach(() => {
    service.dispose();
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts one worker with default producer settings and a base-relative Wasm URL', () => {
    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]).toMatchObject({
      type: 'START',
      runId: 1,
      settings: {
        instrumentCount: 5,
        updatesPerBatch: 100,
        batchInterval: 500
      },
      seed: 1
    });
    expect(worker.requests[0].type === 'START' &&
      worker.requests[0].wasmModuleUrl
    ).toContain('assets/market-pulse-wasm/market_pulse_wasm.js');
  });

  it('resets and restarts on apply even while paused, ignoring stale batches and errors', () => {
    worker.emit({
      type: 'READY',
      runId: 1,
      snapshotId: 0,
      status: 'running',
      metrics: [metric(40)]
    });
    expect(service.metrics()[0].volume).toBe(40);

    service.pause();
    expect(service.status()).toBe('running');

    vi.useFakeTimers();
    setTimeout(() => {
      worker.emit({ type: 'BATCH', runId: 1, snapshotId: 1, metrics: [metric(99)] });
      worker.emit({ type: 'ERROR', runId: 1, error: 'stale failure' });
    }, 100);

    service.applySettings({
      instrumentCount: 2,
      updatesPerBatch: 20,
      batchInterval: 250
    });

    expect(service.runId()).toBe(2);
    expect(service.metrics()).toEqual([]);
    expect(service.settings()).toEqual({
      instrumentCount: 2,
      updatesPerBatch: 20,
      batchInterval: 250
    });
    expect(service.status()).toBe('initializing');
    expect(worker.requests.at(-1)).toMatchObject({
      type: 'START',
      runId: 2,
      settings: service.settings()
    });

    vi.advanceTimersByTime(100);
    expect(service.metrics()).toEqual([]);
    expect(service.error()).toBeNull();
    expect(service.lastEvent()).toBeNull();

    worker.emit({
      type: 'READY',
      runId: 2,
      snapshotId: 0,
      status: 'running',
      metrics: [metric(0), { ...metric(0), instrument: 'BETA' }]
    });
    expect(service.status()).toBe('running');
    expect(service.metrics().map((entry) => entry.volume)).toEqual([0, 0]);
  });

  it('pauses and resumes without clearing metrics or changing the run', () => {
    worker.emit({
      type: 'READY',
      runId: 1,
      snapshotId: 0,
      status: 'running',
      metrics: [metric(20)]
    });

    service.pause();
    expect(service.status()).toBe('running');
    expect(service.metrics()[0].volume).toBe(20);
    expect(worker.requests.at(-1)).toMatchObject({ type: 'PAUSE', runId: 1 });
    expect(service.lastEvent()).toBeNull();

    const pauseRequest = worker.requests.at(-1);
    if (pauseRequest?.type !== 'PAUSE') {
      throw new Error('Expected a PAUSE request');
    }
    worker.emit({
      type: 'PAUSED',
      runId: pauseRequest.runId,
      commandId: pauseRequest.commandId
    });
    expect(service.status()).toBe('paused');
    expect(service.lastEvent()?.type).toBe('paused');

    service.resume();
    expect(service.status()).toBe('paused');
    expect(service.runId()).toBe(1);
    expect(service.metrics()[0].volume).toBe(20);
    expect(worker.requests.at(-1)).toMatchObject({ type: 'RESUME', runId: 1 });

    const resumeRequest = worker.requests.at(-1);
    if (resumeRequest?.type !== 'RESUME') {
      throw new Error('Expected a RESUME request');
    }
    worker.emit({
      type: 'RESUMED',
      runId: resumeRequest.runId,
      commandId: resumeRequest.commandId
    });
    expect(service.status()).toBe('running');
    expect(service.lastEvent()?.type).toBe('resumed');
  });

  it('emits settings-applied only after the matching READY acknowledgement', () => {
    service.applySettings({
      instrumentCount: 3,
      updatesPerBatch: 25,
      batchInterval: 750
    });

    expect(service.lastEvent()).toBeNull();
    worker.emit({
      type: 'READY',
      runId: 1,
      snapshotId: 0,
      status: 'running',
      metrics: []
    });
    expect(service.lastEvent()).toBeNull();

    worker.emit({
      type: 'READY',
      runId: 2,
      snapshotId: 0,
      status: 'running',
      metrics: []
    });
    expect(service.lastEvent()).toMatchObject({
      type: 'settings-applied',
      runId: 2,
      settings: {
        instrumentCount: 3,
        updatesPerBatch: 25,
        batchInterval: 750
      }
    });
  });

  it('ignores stale acknowledgements and stale errors', () => {
    service.applySettings({
      instrumentCount: 3,
      updatesPerBatch: 25,
      batchInterval: 750
    });
    worker.emit({
      type: 'READY',
      runId: 2,
      snapshotId: 0,
      status: 'running',
      metrics: []
    });
    const latestEvent = service.lastEvent();

    worker.emit({ type: 'ERROR', runId: 1, error: 'stale failure' });
    worker.emit({ type: 'PAUSED', runId: 2, commandId: 99 });
    expect(service.lastEvent()).toBe(latestEvent);
    expect(service.error()).toBeNull();
  });

  it('keeps only the latest run and de-duplicates pending pause and resume commands', () => {
    service.applySettings({
      instrumentCount: 3,
      updatesPerBatch: 25,
      batchInterval: 750
    });
    service.applySettings({
      instrumentCount: 4,
      updatesPerBatch: 50,
      batchInterval: 250
    });

    expect(worker.requests.filter((request) => request.type === 'START')).toHaveLength(3);

    worker.emit({
      type: 'READY',
      runId: 2,
      snapshotId: 0,
      status: 'running',
      metrics: [metric(12)]
    });
    expect(service.metrics()).toEqual([]);

    worker.emit({
      type: 'READY',
      runId: 3,
      snapshotId: 0,
      status: 'running',
      metrics: [metric(0)]
    });
    service.pause();
    service.pause();
    expect(worker.requests.filter((request) => request.type === 'PAUSE')).toHaveLength(1);

    const pauseRequest = worker.requests.at(-1);
    if (pauseRequest?.type !== 'PAUSE') {
      throw new Error('Expected a PAUSE request');
    }
    worker.emit({
      type: 'PAUSED',
      runId: pauseRequest.runId,
      commandId: pauseRequest.commandId
    });

    service.resume();
    service.resume();
    expect(worker.requests.filter((request) => request.type === 'RESUME')).toHaveLength(1);
    expect(service.metrics()[0].volume).toBe(0);
    expect(service.runId()).toBe(3);
  });

  it('keeps a pause issued during initialization after READY arrives', () => {
    service.pause();
    const pauseRequest = worker.requests.at(-1);
    if (pauseRequest?.type !== 'PAUSE') {
      throw new Error('Expected a PAUSE request');
    }

    worker.emit({
      type: 'PAUSED',
      runId: pauseRequest.runId,
      commandId: pauseRequest.commandId
    });
    expect(service.status()).toBe('paused');

    worker.emit({
      type: 'READY',
      runId: 1,
      snapshotId: 0,
      status: 'paused',
      metrics: [metric(0)]
    });

    expect(service.status()).toBe('paused');
    expect(service.metrics()).toEqual([metric(0)]);
    expect(service.lastEvent()?.type).toBe('paused');

    service.applySettings({
      instrumentCount: 2,
      updatesPerBatch: 20,
      batchInterval: 250
    });
    expect(service.status()).toBe('initializing');
    worker.emit({
      type: 'READY',
      runId: 2,
      snapshotId: 0,
      status: 'running',
      metrics: [metric(0), { ...metric(0), instrument: 'BETA' }]
    });
    expect(service.status()).toBe('running');
    expect(service.lastEvent()?.type).toBe('settings-applied');
  });

  it('ignores out-of-order and duplicate snapshots within the same run', () => {
    worker.emit({
      type: 'READY',
      runId: 1,
      snapshotId: 0,
      status: 'running',
      metrics: [metric(0)]
    });

    worker.emit({
      type: 'BATCH',
      runId: 1,
      snapshotId: 2,
      metrics: [metric(200)]
    });
    worker.emit({
      type: 'BATCH',
      runId: 1,
      snapshotId: 1,
      metrics: [metric(100)]
    });
    worker.emit({
      type: 'BATCH',
      runId: 1,
      snapshotId: 2,
      metrics: [metric(200)]
    });
    worker.emit({
      type: 'BATCH',
      runId: 1,
      snapshotId: Number.NaN,
      metrics: [metric(300)]
    });

    expect(service.metrics()).toEqual([metric(200)]);
  });

  it('applies Pause → Resume → Pause acknowledgements once and in command order', () => {
    worker.emit({
      type: 'READY',
      runId: 1,
      snapshotId: 0,
      status: 'running',
      metrics: [metric(12)]
    });

    service.pause();
    const pause1 = worker.requests.at(-1);
    if (pause1?.type !== 'PAUSE') {
      throw new Error('Expected first PAUSE request');
    }
    worker.emit({ type: 'PAUSED', runId: 1, commandId: pause1.commandId });
    const firstPauseEvent = service.lastEvent();
    worker.emit({ type: 'PAUSED', runId: 1, commandId: pause1.commandId });
    expect(service.lastEvent()).toBe(firstPauseEvent);

    service.resume();
    const resume = worker.requests.at(-1);
    if (resume?.type !== 'RESUME') {
      throw new Error('Expected RESUME request');
    }
    worker.emit({ type: 'RESUMED', runId: 1, commandId: resume.commandId });

    service.pause();
    const pause2 = worker.requests.at(-1);
    if (pause2?.type !== 'PAUSE') {
      throw new Error('Expected second PAUSE request');
    }
    worker.emit({ type: 'PAUSED', runId: 1, commandId: pause2.commandId });

    expect([pause1.commandId, resume.commandId, pause2.commandId]).toEqual([1, 2, 3]);
    expect(service.status()).toBe('paused');
    expect(service.metrics()).toEqual([metric(12)]);
  });

  it('exposes current worker errors and disposes the worker once', () => {
    worker.emit({ type: 'ERROR', runId: 1, error: 'Wasm initialization failed' });

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('Wasm initialization failed');
    expect(service.lastEvent()).toMatchObject({
      type: 'error',
      message: 'Wasm initialization failed'
    });

    service.dispose();
    service.dispose();

    expect(service.status()).toBe('disposed');
    expect(worker.requests.at(-1)).toEqual({ type: 'DISPOSE', runId: 1 });
    expect(worker.terminated).toBe(true);
    expect(worker.requests.filter((request) => request.type === 'DISPOSE')).toHaveLength(1);

    service.applySettings({
      instrumentCount: 3,
      updatesPerBatch: 25,
      batchInterval: 750
    });
    expect(service.status()).toBe('disposed');
    expect(service.runId()).toBe(1);

    const disposedEvent = service.lastEvent();
    worker.emit({ type: 'ERROR', runId: 1, error: 'late failure' });
    expect(service.status()).toBe('disposed');
    expect(service.lastEvent()).toBe(disposedEvent);
  });

  it.each<[string, Partial<ProducerSettings>]>([
    ['instrumentCount below minimum', { instrumentCount: 0 }],
    ['instrumentCount above maximum', { instrumentCount: 51 }],
    ['fractional instrumentCount', { instrumentCount: 2.5 }],
    ['unsafe instrumentCount', { instrumentCount: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-finite instrumentCount', { instrumentCount: Number.POSITIVE_INFINITY }],
    ['updatesPerBatch below minimum', { updatesPerBatch: 0 }],
    ['updatesPerBatch above maximum', { updatesPerBatch: 1_001 }],
    ['fractional updatesPerBatch', { updatesPerBatch: 10.5 }],
    ['NaN updatesPerBatch', { updatesPerBatch: Number.NaN }],
    ['batchInterval below minimum', { batchInterval: 49 }],
    ['batchInterval above maximum', { batchInterval: 2_001 }],
    ['fractional batchInterval', { batchInterval: 100.5 }]
  ])(
    'rejects invalid programmatic settings (%s) without changing the active run',
    (_description, override) => {
      const initialSettings = service.settings();
      const initialMetrics = service.metrics();
      const initialRunId = service.runId();
      const initialMessageCount = worker.requests.length;

      expect(() => service.applySettings({
        ...initialSettings,
        ...override
      })).toThrow(RangeError);

      expect(service.settings()).toBe(initialSettings);
      expect(service.metrics()).toBe(initialMetrics);
      expect(service.runId()).toBe(initialRunId);
      expect(worker.requests).toHaveLength(initialMessageCount);
    }
  );

});
