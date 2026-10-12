import { MarketUpdate } from '../models/market-update.model';
import { MarketMetrics } from '../models/market-metrics.model';
import { createEmptyMetrics, updateMetrics } from './market-calculations';

export class MarketAggregator {
  private metricsByInstrument = new Map<string, MarketMetrics>();

  constructor(symbols: string[] = []) {
    this.reset(symbols);
  }

  processBatch(updates: MarketUpdate[]): void {
    const unknownSymbols = new Set<string>();

    for (const update of updates) {
      if (!this.metricsByInstrument.has(update.instrument)) {
        unknownSymbols.add(update.instrument);
      }
    }

    if (unknownSymbols.size > 0) {
      const symbols = Array.from(unknownSymbols).join(', ');
      throw new Error(`Unknown instrument symbol(s): ${symbols}`);
    }

    for (const update of updates) {
      const current = this.metricsByInstrument.get(update.instrument);

      if (!current) {
        throw new Error(`Unknown instrument symbol: ${update.instrument}`);
      }

      this.metricsByInstrument.set(
        update.instrument,
        updateMetrics(current, update)
      );
    }
  }

  getMetrics(): MarketMetrics[] {
    return Array.from(this.metricsByInstrument.values(), (metrics) => ({
      ...metrics,
    }));
  }

  reset(symbols: string[]): void {
    const uniqueSymbols = Array.from(
      new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))
    );

    this.metricsByInstrument = new Map<string, MarketMetrics>(
      uniqueSymbols.map((symbol) => [symbol, createEmptyMetrics(symbol)])
    );
  }
}
