import { MarketUpdate } from '../models/market-update.model';
import { MarketMetrics } from '../models/market-metrics.model';

export function createEmptyMetrics(
  instrument: string
): MarketMetrics {
  return {
    instrument,
    lastPriceCents: null,
    volume: 0,
    totalPriceQuantity: 0,
    bidCents: null,
    askCents: null,
    bidQuantity: null,
    askQuantity: null,
  };
}

export function updateMetrics(
  metrics: MarketMetrics,
  update: MarketUpdate
): MarketMetrics {
  return {
    ...metrics,

    lastPriceCents: update.priceCents,

    volume:
      metrics.volume + update.tradeQuantity,

    totalPriceQuantity:
      metrics.totalPriceQuantity +
      update.priceCents * update.tradeQuantity,

    bidCents: update.bidCents,
    askCents: update.askCents,

    bidQuantity: update.bidQuantity,
    askQuantity: update.askQuantity,
  };
}

export function calculateVwap(
  metrics: MarketMetrics
): number | null {
  if (metrics.volume === 0) return null;

  return (metrics.totalPriceQuantity / metrics.volume) / 100;
}

export function calculateSpread(
  metrics: MarketMetrics
): number | null {
  if (metrics.bidCents === null || metrics.askCents === null) return null;

  return (metrics.askCents - metrics.bidCents) / 100;
}

export function calculateImbalance(
  metrics: MarketMetrics
): number | null {
  if (metrics.bidQuantity === null || metrics.askQuantity === null) return null;

  const total = metrics.bidQuantity + metrics.askQuantity;

  if (total === 0) return null;

  return (metrics.bidQuantity - metrics.askQuantity) / total;
}
