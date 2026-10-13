import {
  DestroyRef,
  Injectable,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';

import { MarketService } from './market';

export type NotificationType = 'success' | 'warning' | 'error';
export type NotificationCategory = 'settings' | 'market-state';

export interface Notification {
  id: number;
  type: NotificationType;
  message: string;
  exiting: boolean;
  category?: NotificationCategory;
}

export const NOTIFICATION_AUTO_DISMISS_MS = 10_000;
export const NOTIFICATION_EXIT_MS = 250;
const MAX_VISIBLE_NOTIFICATIONS = 3;

interface NotificationTimer {
  handle: ReturnType<typeof setTimeout>;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly marketService = inject(MarketService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _notifications = signal<Notification[]>([]);
  readonly notifications = this._notifications.asReadonly();

  private readonly timers = new Map<number, NotificationTimer>();
  private readonly queuedNotifications: Notification[] = [];
  private nextId = 0;
  private lastProcessedEventId: number | null = null;

  constructor() {
    effect(() => {
      const event = this.marketService.lastEvent();
      if (!event || event.id === this.lastProcessedEventId) {
        return;
      }

      this.lastProcessedEventId = event.id;
      untracked(() => {
        switch (event.type) {
          case 'settings-applied': {
            const { instrumentCount, updatesPerBatch, batchInterval } = event.settings;
            this.add(
              'success',
              `Settings applied: ${instrumentCount} instruments, ${updatesPerBatch} updates per batch, ${batchInterval} ms interval.`,
              'settings'
            );
            break;
          }
          case 'paused':
            this.add('warning', 'Market paused.', 'market-state');
            break;
          case 'resumed':
            this.add('success', 'Market resumed.', 'market-state');
            break;
          case 'error':
            this.add('error', `Market error: ${event.message}`);
            break;
        }
      });
    });

    this.destroyRef.onDestroy(() => this.clearTimers());
  }

  add(
    type: NotificationType,
    message: string,
    category?: NotificationCategory
  ): number {
    return untracked(() => {
      if (category) {
        this.replaceCategory(category);
      }

      const notification: Notification = {
        id: ++this.nextId,
        type,
        message,
        exiting: false,
        category
      };

      if (this._notifications().length < MAX_VISIBLE_NOTIFICATIONS) {
        this.show(notification);
      } else {
        this.queuedNotifications.push(notification);
      }

      return notification.id;
    });
  }

  private replaceCategory(category: NotificationCategory): void {
    const queuedIndexes = this.queuedNotifications
      .map((notification, index) => notification.category === category ? index : -1)
      .filter((index) => index >= 0);

    for (const index of queuedIndexes.reverse()) {
      this.queuedNotifications.splice(index, 1);
    }

    const existing = this._notifications()
      .filter((notification) => notification.category === category);
    for (const notification of existing) {
      this.dismiss(notification.id);
    }
  }

  dismiss(id: number): void {
    const queuedIndex = this.queuedNotifications.findIndex(
      (notification) => notification.id === id
    );
    if (queuedIndex >= 0) {
      this.queuedNotifications.splice(queuedIndex, 1);
      return;
    }

    const notification = this._notifications().find((item) => item.id === id);
    if (!notification || notification.exiting) {
      return;
    }

    this.clearTimer(id);
    this._notifications.update((notifications) =>
      notifications.map((item) =>
        item.id === id ? { ...item, exiting: true } : item
      )
    );
    this.timers.set(id, {
      handle: setTimeout(() => this.removeAfterExit(id), NOTIFICATION_EXIT_MS)
    });
  }

  private show(notification: Notification): void {
    this._notifications.update((notifications) => [...notifications, notification]);
    if (notification.type !== 'error') {
      this.timers.set(notification.id, {
        handle: setTimeout(
          () => this.dismiss(notification.id),
          NOTIFICATION_AUTO_DISMISS_MS
        )
      });
    }
  }

  private removeAfterExit(id: number): void {
    this.clearTimer(id);
    this._notifications.update((notifications) =>
      notifications.filter((notification) => notification.id !== id)
    );

    const next = this.queuedNotifications.shift();
    if (next) {
      this.show(next);
    }
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer.handle);
      this.timers.delete(id);
    }
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer.handle);
    }
    this.timers.clear();
    this.queuedNotifications.length = 0;
  }
}
