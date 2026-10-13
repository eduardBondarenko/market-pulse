
import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import {
  DEFAULT_SETTINGS,
  ProducerSettings
} from '../models/producer-settings.model';
import { MarketMetrics } from '../models/market-metrics.model';
import {
  MarketWorkerRequest,
  MarketWorkerResponse
} from '../workers/market-worker-messages';

export type MarketServiceStatus =
  | 'initializing'
  | 'running'
  | 'paused'
  | 'error'
  | 'disposed';

export type MarketServiceEvent =
  | {
      id: number;
      type: 'settings-applied';
      runId: number;
      settings: ProducerSettings;
    }
  | { id: number; type: 'paused' | 'resumed'; runId: number }
  | { id: number; type: 'error'; runId: number; message: string };

export function isValidProducerSettings(
  settings: ProducerSettings
): boolean {
  return Number.isSafeInteger(settings.instrumentCount) &&
    settings.instrumentCount >= 1 &&
    settings.instrumentCount <= 50 &&
    Number.isSafeInteger(settings.updatesPerBatch) &&
    settings.updatesPerBatch >= 1 &&
    settings.updatesPerBatch <= 1_000 &&
    Number.isSafeInteger(settings.batchInterval) &&
    settings.batchInterval >= 50 &&
    settings.batchInterval <= 2_000;
}

type MarketServiceEventInput =
  | { type: 'settings-applied'; runId: number; settings: ProducerSettings }
  | { type: 'paused' | 'resumed'; runId: number }
  | { type: 'error'; runId: number; message: string };

interface PendingTransition {
  type: 'pause' | 'resume';
  runId: number;
  commandId: number;
}

@Injectable({
  providedIn: 'root'
})
export class MarketService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly worker: Worker | null;

  private readonly _metrics = signal<MarketMetrics[]>([]);
  readonly metrics = this._metrics.asReadonly();

  private readonly _status = signal<MarketServiceStatus>('initializing');
  readonly status = this._status.asReadonly();

  private readonly _settings = signal<ProducerSettings>({ ...DEFAULT_SETTINGS });
  readonly settings = this._settings.asReadonly();

  private readonly _runId = signal(1);
  readonly runId = this._runId.asReadonly();

  private readonly _error = signal<string | null>(null);
  readonly error = this._error.asReadonly();

  private readonly _lastEvent = signal<MarketServiceEvent | null>(null);
  readonly lastEvent = this._lastEvent.asReadonly();

  private nextEventId = 0;
  private nextCommandId = 0;
  private pendingApplyRunId: number | null = null;
  private pendingTransition: PendingTransition | null = null;
  private lastSnapshotRunId = 1;
  private lastSnapshotId = -1;

  private readonly wasmModuleUrl = new URL(
    'assets/market-pulse-wasm/market_pulse_wasm.js',
    this.document.baseURI
  ).href;

  constructor() {
    try {
      this.worker = new Worker(new URL('../workers/market.worker', import.meta.url), {
        type: 'module'
      });
      this.worker.addEventListener('message', this.handleWorkerMessage);
      this.worker.addEventListener('error', this.handleWorkerError);
      this.worker.addEventListener('messageerror', this.handleWorkerMessageError);
      this.destroyRef.onDestroy(() => this.dispose());
      this.postStart();
    } catch (error) {
      this.worker = null;
      this.setError(error);
      this.destroyRef.onDestroy(() => this.dispose());
    }
  }

  get activeSettings() {
    return this.settings;
  }

  applySettings(settings: ProducerSettings): void {
    if (this._status() === 'disposed') {
      return;
    }

    if (!isValidProducerSettings(settings)) {
      throw new RangeError(
        'Invalid producer settings: instrumentCount must be an integer from 1 to 50, ' +
        'updatesPerBatch must be an integer from 1 to 1000, and batchInterval ' +
        'must be an integer from 50 to 2000 milliseconds.'
      );
    }

    this._runId.update((id) => id + 1);
    this._settings.set({ ...settings });
    this._metrics.set([]);
    this._status.set('initializing');
    this._error.set(null);
    this.pendingApplyRunId = this.runId();
    this.pendingTransition = null;
    this.lastSnapshotRunId = this.runId();
    this.lastSnapshotId = -1;
    this.postStart();
  }

  pause(): void {
    if (
      (this._status() !== 'running' && this._status() !== 'initializing') ||
      this.pendingTransition
    ) {
      return;
    }

    const transition = this.createPendingTransition('pause');
    this.pendingTransition = transition;
    this.post({
      type: 'PAUSE',
      runId: transition.runId,
      commandId: transition.commandId
    });
  }

  resume(): void {
    if (this._status() !== 'paused' || this.pendingTransition) {
      return;
    }

    const transition = this.createPendingTransition('resume');
    this.pendingTransition = transition;
    this.post({
      type: 'RESUME',
      runId: transition.runId,
      commandId: transition.commandId
    });
  }

  dispose(): void {
    if (this._status() === 'disposed') {
      return;
    }

    this._status.set('disposed');
    this.worker?.removeEventListener('message', this.handleWorkerMessage);
    this.worker?.removeEventListener('error', this.handleWorkerError);
    this.worker?.removeEventListener('messageerror', this.handleWorkerMessageError);
    this.post({ type: 'DISPOSE', runId: this.runId() });
    this.worker?.terminate();
  }

  private readonly handleWorkerMessage = (
    event: MessageEvent<MarketWorkerResponse>
  ): void => {
    const message = event.data;
    if (message.runId !== this.runId() || this._status() === 'disposed') {
      return;
    }

    switch (message.type) {
      case 'READY':
        if (
          (this._status() !== 'initializing' &&
            !(this._status() === 'paused' && message.status === 'paused')) ||
          message.snapshotId !== 0 ||
          !this.acceptSnapshot(message.runId, message.snapshotId)
        ) {
          return;
        }
        this._metrics.set(message.metrics);
        this._status.set(message.status);
        this._error.set(null);
        if (this.pendingApplyRunId === message.runId) {
          this.pendingApplyRunId = null;
          this.emitEvent({
            type: 'settings-applied',
            runId: message.runId,
            settings: { ...this.settings() }
          });
        }
        break;
      case 'BATCH':
        if (
          (this._status() !== 'running' && this._status() !== 'paused') ||
          !this.acceptSnapshot(message.runId, message.snapshotId)
        ) {
          return;
        }
        this._metrics.set(message.metrics);
        break;
      case 'PAUSED':
        this.acknowledgeTransition(message, 'pause', 'paused');
        break;
      case 'RESUMED':
        this.acknowledgeTransition(message, 'resume', 'running');
        break;
      case 'ERROR':
        this.pendingApplyRunId = null;
        this.pendingTransition = null;
        this.setError(message.error);
        break;
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    if (this._status() === 'disposed') {
      return;
    }
    this.setError(event.message || 'Market Worker failed');
  };

  private readonly handleWorkerMessageError = (): void => {
    if (this._status() === 'disposed') {
      return;
    }
    this.setError('Market Worker sent a message that could not be deserialized');
  };

  private postStart(): void {
    this.post({
      type: 'START',
      runId: this.runId(),
      settings: this.settings(),
      seed: this.runId() >>> 0,
      wasmModuleUrl: this.wasmModuleUrl
    });
  }

  private createPendingTransition(type: 'pause' | 'resume'): PendingTransition {
    return {
      type,
      runId: this.runId(),
      commandId: ++this.nextCommandId
    };
  }

  private acceptSnapshot(runId: number, snapshotId: number): boolean {
    if (!Number.isSafeInteger(snapshotId) || snapshotId < 0) {
      return false;
    }

    if (this.lastSnapshotRunId !== runId) {
      this.lastSnapshotRunId = runId;
      this.lastSnapshotId = -1;
    }

    if (snapshotId <= this.lastSnapshotId) {
      return false;
    }

    this.lastSnapshotId = snapshotId;
    return true;
  }

  private acknowledgeTransition(
    message: Extract<MarketWorkerResponse, { type: 'PAUSED' | 'RESUMED' }>,
    expectedType: PendingTransition['type'],
    status: 'paused' | 'running'
  ): void {
    const pending = this.pendingTransition;
    if (
      !pending ||
      pending.runId !== message.runId ||
      pending.commandId !== message.commandId ||
      pending.type !== expectedType
    ) {
      return;
    }

    this.pendingTransition = null;
    this._status.set(status);
    this.emitEvent({
      type: expectedType === 'pause' ? 'paused' : 'resumed',
      runId: message.runId
    });
  }

  private post(message: MarketWorkerRequest): void {
    if (this._status() === 'disposed' && message.type !== 'DISPOSE') {
      return;
    }

    if (!this.worker) {
      if (message.type !== 'DISPOSE') {
        this.setError('Market Worker is unavailable');
      }
      return;
    }

    try {
      this.worker.postMessage(message);
    } catch (error) {
      this.setError(error);
    }
  }

  private setError(error: unknown): void {
    if (this._status() === 'disposed') {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (this._status() === 'error' && this._error() === message) {
      return;
    }

    this.pendingApplyRunId = null;
    this.pendingTransition = null;
    this._error.set(message);
    this._status.set('error');
    this.emitEvent({ type: 'error', runId: this.runId(), message });
  }

  private emitEvent(event: MarketServiceEventInput): void {
    this._lastEvent.set({
      ...event,
      id: ++this.nextEventId
    });
  }
}
