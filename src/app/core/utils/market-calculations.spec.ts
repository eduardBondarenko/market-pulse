import { describe, expect, it } from 'vitest';

import {
  createEmptyMetrics,
  updateMetrics,
  calculateVwap,
  calculateSpread,
  calculateImbalance,
} from './market-calculations';

import { MarketUpdate } from '../models/market-update.model';

describe('Market calculations', () => {

  const firstTrade: MarketUpdate = {
    instrument: 'ALFA',
    priceCents: 10000,
    tradeQuantity: 10,
    bidCents: 9996,
    askCents: 10000,
    bidQuantity: 500,
    askQuantity: 500,
  };

  const secondTrade: MarketUpdate = {
    instrument: 'ALFA',
    priceCents: 10200,
    tradeQuantity: 30,
    bidCents: 10196,
    askCents: 10200,
    bidQuantity: 600,
    askQuantity: 400,
  };

  it('should initialize empty metrics correctly', () => {
    const metrics = createEmptyMetrics('ALFA');

    expect(metrics.instrument).toBe('ALFA');
    expect(metrics.lastPriceCents).toBeNull();
    expect(metrics.volume).toBe(0);
    expect(calculateVwap(metrics)).toBeNull();
    expect(calculateSpread(metrics)).toBeNull();
    expect(calculateImbalance(metrics)).toBeNull();
  });

  it('should calculate metrics from the worked example', () => {
    let metrics = createEmptyMetrics('ALFA');

    metrics = updateMetrics(metrics, firstTrade);
    metrics = updateMetrics(metrics, secondTrade);

    expect(metrics.lastPriceCents).toBe(10200);
    expect(metrics.volume).toBe(40);
    expect(calculateVwap(metrics)).toBe(101.5);
    expect(calculateSpread(metrics)).toBeCloseTo(0.04);
    expect(calculateImbalance(metrics)).toBeCloseTo(0.2);
  });

  it('should return null when imbalance denominator is zero', () => {
    const metrics = createEmptyMetrics('ALFA');

    const updated = {
      ...metrics,
      bidQuantity: 0,
      askQuantity: 0,
    };

    expect(calculateImbalance(updated)).toBeNull();
  });

  it('should not mutate previous metrics', () => {
    const original = createEmptyMetrics('ALFA');
    const updated = updateMetrics(original, firstTrade);

    expect(original.volume).toBe(0);
    expect(original.lastPriceCents).toBeNull();

    expect(updated.volume).toBe(10);
    expect(updated.lastPriceCents).toBe(10000);
    expect(updated).not.toBe(original);
  });

  it('should keep instruments independent', () => {
    let alfa = createEmptyMetrics('ALFA');
    let beta = createEmptyMetrics('BETA');

    alfa = updateMetrics(alfa, firstTrade);

    expect(alfa.volume).toBe(10);
    expect(beta.volume).toBe(0);
    expect(beta.lastPriceCents).toBeNull();
  });

});
