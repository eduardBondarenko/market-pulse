import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';

import { MarketServiceEvent } from './market';
import { MarketService } from './market';
import {
  NOTIFICATION_AUTO_DISMISS_MS,
  NOTIFICATION_EXIT_MS,
  NotificationService
} from './notification';

describe('NotificationService', () => {
  let notifications: NotificationService;
  let lastEvent: ReturnType<typeof signal<MarketServiceEvent | null>>;

  beforeEach(() => {
    vi.useFakeTimers();
    lastEvent = signal<MarketServiceEvent | null>(null);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MarketService,
          useValue: { lastEvent: lastEvent.asReadonly() }
        }
      ]
    });
    notifications = TestBed.inject(NotificationService);
    TestBed.flushEffects();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('shows at most three notifications and queues the next until an exit completes', () => {
    const first = notifications.add('success', 'First');
    notifications.add('warning', 'Second');
    notifications.add('error', 'Third');
    const fourth = notifications.add('success', 'Fourth');

    expect(notifications.notifications().map(({ message }) => message)).toEqual([
      'First',
      'Second',
      'Third'
    ]);

    notifications.dismiss(first);
    notifications.dismiss(first);
    expect(notifications.notifications()).toHaveLength(3);
    expect(notifications.notifications()[0].exiting).toBe(true);

    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    expect(notifications.notifications().map(({ message }) => message)).toEqual([
      'Second',
      'Third',
      'Fourth'
    ]);
    expect(notifications.notifications().find(({ id }) => id === fourth)?.exiting)
      .toBe(false);
  });

  it('keeps success and warning notifications during exit after thirty seconds', () => {
    notifications.add('success', 'Applied');
    notifications.add('warning', 'Paused');

    vi.advanceTimersByTime(NOTIFICATION_AUTO_DISMISS_MS - 1);
    expect(notifications.notifications()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(notifications.notifications().every(({ exiting }) => exiting)).toBe(true);
    expect(notifications.notifications()).toHaveLength(2);
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    expect(notifications.notifications()).toEqual([]);
  });

  it('keeps errors visible until manually dismissed', () => {
    const id = notifications.add('error', 'Wasm failed');

    vi.advanceTimersByTime(60_000);
    expect(notifications.notifications()).toHaveLength(1);
    expect(notifications.notifications()[0].message).toBe('Wasm failed');

    notifications.dismiss(id);
    expect(notifications.notifications()).toHaveLength(1);
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    expect(notifications.notifications()).toEqual([]);
  });

  it('removes the last notification after the exit animation', () => {
    const id = notifications.add('success', 'Last notification');

    notifications.dismiss(id);

    expect(notifications.notifications()).toHaveLength(1);
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    expect(notifications.notifications()).toEqual([]);
  });

  it('does not notify for automatic startup and maps only published service events', () => {
    expect(notifications.notifications()).toEqual([]);

    lastEvent.set({
      id: 1,
      type: 'settings-applied',
      runId: 2,
      settings: {
        instrumentCount: 5,
        updatesPerBatch: 100,
        batchInterval: 500
      }
    });
    TestBed.flushEffects();
    expect(notifications.notifications()[0]).toMatchObject({
      type: 'success',
      message: 'Settings applied: 5 instruments, 100 updates per batch, 500 ms interval.'
    });

    lastEvent.set({ id: 2, type: 'paused', runId: 2 });
    TestBed.flushEffects();
    expect(notifications.notifications()[1]).toMatchObject({
      type: 'warning',
      message: 'Market paused.'
    });

    lastEvent.set({ id: 3, type: 'resumed', runId: 2 });
    TestBed.flushEffects();
    expect(notifications.notifications()[2]).toMatchObject({
      type: 'success',
      message: 'Market resumed.'
    });

    lastEvent.set({ id: 4, type: 'error', runId: 2, message: 'Worker failed' });
    TestBed.flushEffects();
    expect(notifications.notifications()).toHaveLength(3);
    notifications.dismiss(notifications.notifications()[0].id);
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    expect(notifications.notifications()).toHaveLength(2);
    expect(notifications.notifications()).toContainEqual(
      expect.objectContaining({
      type: 'error',
      message: 'Market error: Worker failed'
      })
    );
  });

  it('does not recreate a dismissed toast when notification signals update', () => {
    lastEvent.set({
      id: 1,
      type: 'error',
      runId: 1,
      message: 'Worker failed'
    });
    TestBed.flushEffects();

    const id = notifications.notifications()[0].id;
    notifications.dismiss(id);
    TestBed.flushEffects();
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);

    expect(notifications.notifications()).toEqual([]);
  });

  it('allows identical notifications to queue independently', () => {
    const firstId = notifications.add('warning', 'Market paused.');
    const duplicateId = notifications.add('warning', 'Market paused.');

    expect(duplicateId).not.toBe(firstId);
    expect(notifications.notifications()).toHaveLength(2);
  });

  it('replaces the previous notification in the same category', () => {
    const oldSettingsId = notifications.add(
      'success',
      'Old settings applied',
      'settings'
    );
    const newSettingsId = notifications.add(
      'success',
      'New settings applied',
      'settings'
    );

    expect(notifications.notifications()).toHaveLength(2);
    expect(
      notifications.notifications().find(({ id }) => id === oldSettingsId)?.exiting
    ).toBe(true);
    expect(
      notifications.notifications().find(({ id }) => id === newSettingsId)?.message
    ).toBe('New settings applied');

    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    expect(notifications.notifications()).toHaveLength(1);
    expect(notifications.notifications()[0]).toMatchObject({
      id: newSettingsId,
      message: 'New settings applied',
      exiting: false
    });
  });

  it('treats pause and resume as one market-state notification category', () => {
    notifications.add('warning', 'Market paused.', 'market-state');
    const resumedId = notifications.add(
      'success',
      'Market resumed.',
      'market-state'
    );

    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    expect(notifications.notifications()).toHaveLength(1);
    expect(notifications.notifications()[0]).toMatchObject({
      id: resumedId,
      type: 'success',
      message: 'Market resumed.'
    });
  });

  it('replaces matching queued notifications without disturbing other categories', () => {
    notifications.add('success', 'Visible settings', 'settings');
    notifications.add('warning', 'Visible pause', 'market-state');
    notifications.add('error', 'Visible error');
    notifications.add('success', 'Queued old settings', 'settings');
    notifications.add('success', 'Queued newer settings', 'settings');

    notifications.dismiss(notifications.notifications()[0].id);
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);

    expect(notifications.notifications().map(({ message }) => message)).toEqual([
      'Visible pause',
      'Visible error',
      'Queued newer settings'
    ]);
  });

  it('clears auto-dismiss and exit timers when manually closed and on service cleanup', () => {
    const id = notifications.add('success', 'Timer cleanup');
    expect(vi.getTimerCount()).toBe(1);

    notifications.dismiss(id);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    expect(vi.getTimerCount()).toBe(0);

    notifications.add('success', 'Cleanup on destroy');
    expect(vi.getTimerCount()).toBe(1);
    TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0);
  });
});
