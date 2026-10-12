import { describe, expect, it } from 'vitest';

import { MarketAggregator } from './market-aggregator';
import { MarketUpdate } from '../models/market-update.model';

const createTrade = (
  instrument: string,
  priceCents: number,
  tradeQuantity: number,
  bidCents: number,
  askCents: number,
  bidQuantity: number,
  askQuantity: number
): MarketUpdate => ({
  instrument,
  priceCents,
  tradeQuantity,
  bidCents,
  askCents,
  bidQuantity,
  askQuantity,
});

describe('MarketAggregator', () => {
  it('initializes all instruments with zero volume and no last price', () => {
    const aggregator = new MarketAggregator(['ALFA', 'BETA']);

    const metrics = aggregator.getMetrics();

    expect(metrics).toHaveLength(2);
    expect(metrics.map((entry) => entry.instrument)).toEqual(['ALFA', 'BETA']);
    expect(metrics.every((entry) => entry.volume === 0)).toBe(true);
    expect(metrics.every((entry) => entry.lastPriceCents === null)).toBe(true);
  });

  it('accumulates volume and VWAP across multiple updates for the same instrument', () => {
    const aggregator = new MarketAggregator(['ALFA']);

    aggregator.processBatch([
      createTrade('ALFA', 10000, 10, 9996, 10000, 500, 500),
      createTrade('ALFA', 10200, 30, 10196, 10200, 600, 400),
    ]);

    const metrics = aggregator.getMetrics();

    expect(metrics).toHaveLength(1);
    expect(metrics[0].volume).toBe(40);
    expect(metrics[0].lastPriceCents).toBe(10200);
    expect(metrics[0].totalPriceQuantity).toBe(10000 * 10 + 10200 * 30);
    expect(metrics[0].bidCents).toBe(10196);
    expect(metrics[0].askCents).toBe(10200);
  });

  it('keeps independent cumulative metrics for multiple instruments', () => {
    const aggregator = new MarketAggregator(['ALFA', 'BETA']);

    aggregator.processBatch([
      createTrade('ALFA', 10000, 5, 9998, 10000, 200, 200),
      createTrade('BETA', 9000, 12, 8995, 9000, 120, 80),
      createTrade('ALFA', 10100, 15, 10096, 10100, 300, 150),
    ]);

    const metrics = aggregator.getMetrics();
    const alfa = metrics.find((entry) => entry.instrument === 'ALFA');
    const beta = metrics.find((entry) => entry.instrument === 'BETA');

    expect(alfa?.volume).toBe(20);
    expect(alfa?.lastPriceCents).toBe(10100);
    expect(beta?.volume).toBe(12);
    expect(beta?.lastPriceCents).toBe(9000);
  });

  it('handles empty batches without changing state', () => {
    const aggregator = new MarketAggregator(['ALFA']);

    aggregator.processBatch([]);

    expect(aggregator.getMetrics()).toEqual([
      {
        instrument: 'ALFA',
        lastPriceCents: null,
        volume: 0,
        totalPriceQuantity: 0,
        bidCents: null,
        askCents: null,
        bidQuantity: null,
        askQuantity: null,
      },
    ]);
  });

  it('clears previous instruments and values on reset', () => {
    const aggregator = new MarketAggregator(['ALFA', 'BETA']);

    aggregator.processBatch([createTrade('ALFA', 10000, 10, 9998, 10000, 100, 100)]);
    aggregator.reset(['BETA', 'GAMMA']);

    expect(aggregator.getMetrics()).toEqual([
      {
        instrument: 'BETA',
        lastPriceCents: null,
        volume: 0,
        totalPriceQuantity: 0,
        bidCents: null,
        askCents: null,
        bidQuantity: null,
        askQuantity: null,
      },
      {
        instrument: 'GAMMA',
        lastPriceCents: null,
        volume: 0,
        totalPriceQuantity: 0,
        bidCents: null,
        askCents: null,
        bidQuantity: null,
        askQuantity: null,
      },
    ]);
  });

  it('rejects unknown instrument symbols and does not partially apply the batch', () => {
    const aggregator = new MarketAggregator(['ALFA', 'BETA']);

    aggregator.processBatch([createTrade('ALFA', 10000, 10, 9998, 10000, 100, 100)]);

    expect(() =>
      aggregator.processBatch([
        createTrade('ALFA', 10100, 5, 10098, 10100, 200, 200),
        createTrade('GAMMA', 11000, 8, 10990, 11000, 300, 300),
      ])
    ).toThrow('Unknown instrument symbol(s): GAMMA');

    const metrics = aggregator.getMetrics();
    const alfa = metrics.find((entry) => entry.instrument === 'ALFA');

    expect(alfa?.volume).toBe(10);
    expect(alfa?.lastPriceCents).toBe(10000);
  });

  it('returns safe snapshots that do not expose mutable internal state', () => {
    const aggregator = new MarketAggregator(['ALFA']);

    const firstSnapshot = aggregator.getMetrics();
    firstSnapshot[0].volume = 999;
    firstSnapshot[0].lastPriceCents = 12345;

    expect(aggregator.getMetrics()[0].volume).toBe(0);
    expect(aggregator.getMetrics()[0].lastPriceCents).toBeNull();

    aggregator.processBatch([createTrade('ALFA', 10000, 10, 9998, 10000, 100, 100)]);
    const secondSnapshot = aggregator.getMetrics();
    secondSnapshot[0].bidQuantity = 123;

    expect(aggregator.getMetrics()[0].bidQuantity).toBe(100);
  });
});
