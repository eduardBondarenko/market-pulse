import { MarketMetrics } from '../models/market-metrics.model';
import { ProducerSettings } from '../models/producer-settings.model';

export type MarketWorkerRequest =
  | {
      type: 'START';
      runId: number;
      settings: ProducerSettings;
      seed: number;
      wasmModuleUrl: string;
    }
  | { type: 'PAUSE'; runId: number; commandId: number }
  | { type: 'RESUME'; runId: number; commandId: number }
  | { type: 'DISPOSE'; runId: number };

export type MarketWorkerResponse =
  | {
      type: 'READY';
      runId: number;
      snapshotId: number;
      status: 'running' | 'paused';
      metrics: MarketMetrics[];
    }
  | {
      type: 'BATCH';
      runId: number;
      snapshotId: number;
      metrics: MarketMetrics[];
    }
  | { type: 'PAUSED'; runId: number; commandId: number }
  | { type: 'RESUMED'; runId: number; commandId: number }
  | { type: 'ERROR'; runId: number; error: string };
