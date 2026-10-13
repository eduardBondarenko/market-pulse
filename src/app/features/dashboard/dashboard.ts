import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  viewChild
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport
} from '@angular/cdk/scrolling';
import { map } from 'rxjs';

import {
  calculateImbalance,
  calculateSpread,
  calculateVwap
} from '../../core/utils/market-calculations';
import { MarketService } from '../../core/services/market';

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const volumeFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0
});

const imbalanceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatUsdCents(cents: number | null): string {
  return cents === null ? '—' : usdFormatter.format(cents / 100);
}

export function formatUsd(value: number | null): string {
  return value === null ? '—' : usdFormatter.format(value);
}

export function formatVolume(volume: number): string {
  return volumeFormatter.format(volume);
}

export function formatImbalance(value: number | null): string {
  return value === null ? '—' : imbalanceFormatter.format(value);
}

interface DashboardRow {
  instrument: string;
  lastPrice: string;
  spread: string;
  volume: string;
  vwap: string;
  imbalance: string;
}

@Component({
  selector: 'app-dashboard',
  imports: [
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    CdkVirtualScrollViewport
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Dashboard {
  readonly marketService = inject(MarketService);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private previousInstrumentCount = this.marketService.settings().instrumentCount;

  readonly isMobile = toSignal(
    this.breakpointObserver.observe('(max-width: 640px)').pipe(
      map(({ matches }) => matches)
    ),
    { initialValue: false }
  );
  readonly itemSize = computed(() => this.isMobile() ? 224 : 52);
  readonly minBufferPx = computed(() => this.itemSize() * 5);
  readonly maxBufferPx = computed(() => this.itemSize() * 10);
  readonly tableMaxHeight = computed(() =>
    this.rows().length === 0
      ? null
      : this.rows().length * this.itemSize() + (this.isMobile() ? 0 : 48)
  );

  readonly rows = computed(() =>
    this.marketService.metrics().map((metrics) => ({
      instrument: metrics.instrument,
      lastPrice: formatUsdCents(metrics.lastPriceCents),
      spread: formatUsd(calculateSpread(metrics)),
      volume: formatVolume(metrics.volume),
      vwap: formatUsd(calculateVwap(metrics)),
      imbalance: formatImbalance(calculateImbalance(metrics))
    }))
  );

  readonly statusLabel = computed(() => {
    switch (this.marketService.status()) {
      case 'initializing':
        return 'Initializing';
      case 'running':
        return 'Running';
      case 'paused':
        return 'Paused';
      case 'error':
        return 'Error';
      case 'disposed':
        return 'Stopped';
    }
  });

  readonly canToggleUpdates = computed(
    () => this.marketService.status() !== 'error' &&
      this.marketService.status() !== 'disposed'
  );

  constructor() {
    effect(() => {
      const instrumentCount = this.marketService.settings().instrumentCount;
      const mobileLayout = this.isMobile();
      const viewport = this.viewport();

      if (viewport && instrumentCount < this.previousInstrumentCount) {
        const currentIndex = viewport.getRenderedRange().start;
        viewport.scrollToIndex(Math.min(currentIndex, instrumentCount - 1));
      }

      if (viewport && mobileLayout !== this.previousMobileLayout) {
        viewport.checkViewportSize();
      }

      this.previousInstrumentCount = instrumentCount;
      this.previousMobileLayout = mobileLayout;
    });
  }

  private previousMobileLayout = this.isMobile();

  trackByInstrument(_index: number, row: DashboardRow): string {
    return row.instrument;
  }

  toggleUpdates(): void {
    if (this.marketService.status() === 'paused') {
      this.marketService.resume();
    } else {
      this.marketService.pause();
    }
  }
}
