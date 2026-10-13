import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketAggregator } from './market-aggregator';
import { LatestSnapshotPublisher } from './latest-snapshot-publisher';
import { calculateVwap } from './market-calculations';
import { MarketUpdate } from '../models/market-update.model';
import { MarketMetrics } from '../models/market-metrics.model';

const trade = (tradeQuantity = 1): MarketUpdate => ({
  instrument: 'ALFA',
  priceCents: 10_000,
  tradeQuantity,
  bidCents: 9_999,
  askCents: 10_000,
  bidQuantity: 10,
  askQuantity: 10
});

describe('LatestSnapshotPublisher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces 20 batches per second and retains every generated trade in final metrics', () => {
    vi.useFakeTimers();
    const aggregator = new MarketAggregator(['ALFA']);
    const snapshots: MarketMetrics[][] = [];
    const publisher = new LatestSnapshotPublisher<MarketMetrics[]>(
      (snapshot) => snapshots.push(snapshot),
      100
    );

    for (let batch = 0; batch < 20; batch += 1) {
      vi.advanceTimersByTime(50);
      aggregator.processBatch(Array.from({ length: 1_000 }, () => trade()));
      publisher.publish(() => aggregator.getMetrics());
    }

    expect(snapshots).toHaveLength(10);
    expect(snapshots.at(-1)?.[0].volume).toBe(18_000);

    vi.advanceTimersByTime(100);
    expect(snapshots).toHaveLength(11);
    expect(snapshots.at(-1)?.[0].volume).toBe(20_000);
    expect(aggregator.getMetrics()[0].volume).toBe(20_000);
    expect(aggregator.getMetrics()[0].totalPriceQuantity).toBe(200_000_000);
    expect(calculateVwap(aggregator.getMetrics()[0])).toBe(100);
    publisher.dispose();
  });

  it('immediately publishes the first snapshot and does not delay slow batches', () => {
    vi.useFakeTimers();
    const snapshots: number[] = [];
    const publisher = new LatestSnapshotPublisher<number>(
      (snapshot) => snapshots.push(snapshot),
      100
    );

    publisher.publish(() => 1);
    expect(snapshots).toEqual([1]);

    vi.advanceTimersByTime(250);
    publisher.publish(() => 2);
    expect(snapshots).toEqual([1, 2]);
    expect(vi.getTimerCount()).toBe(0);
    publisher.dispose();
  });

  it('flushes the latest cumulative snapshot immediately when paused', () => {
    vi.useFakeTimers();
    const snapshots: number[] = [];
    const publisher = new LatestSnapshotPublisher<number>(
      (snapshot) => snapshots.push(snapshot),
      100
    );

    publisher.publish(() => 1);
    vi.advanceTimersByTime(40);
    publisher.publish(() => 2);
    vi.advanceTimersByTime(40);
    publisher.publish(() => 3);

    publisher.flush();
    expect(snapshots).toEqual([1, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops pending snapshots from the previous run and clears scheduled callbacks', () => {
    vi.useFakeTimers();
    const snapshots: number[] = [];
    const publisher = new LatestSnapshotPublisher<number>(
      (snapshot) => snapshots.push(snapshot),
      100
    );

    publisher.publish(() => 1);
    vi.advanceTimersByTime(50);
    publisher.publish(() => 2);
    expect(vi.getTimerCount()).toBe(1);

    publisher.reset();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(200);
    expect(snapshots).toEqual([1]);

    publisher.publish(() => 3);
    expect(snapshots).toEqual([1, 3]);
    publisher.dispose();
  });
});
