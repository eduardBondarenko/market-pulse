import { signal } from '@angular/core';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketMetrics } from '../../core/models/market-metrics.model';
import { MarketService, MarketServiceStatus } from '../../core/services/market';
import {
  formatImbalance,
  formatUsd,
  formatUsdCents,
  formatVolume,
  Dashboard
} from './dashboard';

const emptyMetric = (instrument: string): MarketMetrics => ({
  instrument,
  lastPriceCents: null,
  volume: 0,
  totalPriceQuantity: 0,
  bidCents: null,
  askCents: null,
  bidQuantity: null,
  askQuantity: null
});

describe('Dashboard formatting', () => {
  it('formats integer cents as USD and keeps unavailable values as a dash', () => {
    expect(formatUsdCents(12_345)).toBe('$123.45');
    expect(formatUsdCents(5)).toBe('$0.05');
    expect(formatUsdCents(null)).toBe('—');
    expect(formatUsd(0.04)).toBe('$0.04');
    expect(formatUsd(null)).toBe('—');
  });

  it('formats zero volume and signed order-book imbalance', () => {
    expect(formatVolume(0)).toBe('0');
    expect(formatImbalance(1)).toBe('1.00');
    expect(formatImbalance(-1)).toBe('-1.00');
    expect(formatImbalance(null)).toBe('—');
  });
});

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let metrics: ReturnType<typeof signal<MarketMetrics[]>>;
  let status: ReturnType<typeof signal<MarketServiceStatus>>;
  let error: ReturnType<typeof signal<string | null>>;
  let settings: ReturnType<typeof signal<{
    instrumentCount: number;
    updatesPerBatch: number;
    batchInterval: number;
  }>>;
  let viewport: CdkVirtualScrollViewport;
  let pause: ReturnType<typeof vi.fn>;
  let resume: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    metrics = signal<MarketMetrics[]>([emptyMetric('ALFA')]);
    status = signal<MarketServiceStatus>('initializing');
    error = signal<string | null>(null);
    settings = signal({
      instrumentCount: 1,
      updatesPerBatch: 100,
      batchInterval: 500
    });
    pause = vi.fn();
    resume = vi.fn();

    TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        {
          provide: MarketService,
          useValue: {
            metrics: metrics.asReadonly(),
            status: status.asReadonly(),
            error: error.asReadonly(),
            runId: signal(1).asReadonly(),
            settings: settings.asReadonly(),
            pause,
            resume
          }
        }
      ]
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    viewport = fixture.debugElement.query(
      By.directive(CdkVirtualScrollViewport)
    ).componentInstance as CdkVirtualScrollViewport;
    const viewportElement = viewport.elementRef.nativeElement;
    vi.spyOn(viewportElement, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, right: 900, bottom: 260, left: 0,
      width: 900, height: 260, toJSON: () => ({})
    });
    Object.defineProperty(viewportElement, 'clientHeight', {
      configurable: true,
      value: 260
    });
    Object.defineProperty(viewportElement, 'scrollTo', {
      configurable: true,
      value: (options: ScrollToOptions) => {
        viewportElement.scrollTop = options.top ?? 0;
        viewportElement.dispatchEvent(new Event('scroll'));
      }
    });
    viewport.checkViewportSize();
    fixture.detectChanges();
  });

  it('renders unavailable metrics as dashes and initial volume as zero', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('[role="row"][aria-rowindex="2"]') as HTMLElement;

    expect(row.textContent).toContain('ALFA');
    const cells = row.querySelectorAll('[role="cell"]');
    expect(Array.from(cells, (cell) => cell.lastElementChild?.textContent?.trim()))
      .toEqual(['—', '—', '0', '—', '—']);
  });

  it('shows metric values derived from aggregator snapshots', () => {
    metrics.set([
      {
        instrument: 'ALFA',
        lastPriceCents: 12_345,
        volume: 5,
        totalPriceQuantity: 61_725,
        bidCents: 12_340,
        askCents: 12_345,
        bidQuantity: 75,
        askQuantity: 25
      }
    ]);
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('[role="row"][aria-rowindex="2"]') as HTMLElement;
    expect(Array.from(row.querySelectorAll('[role="rowheader"], [role="cell"]'), (cell) =>
      cell.getAttribute('role') === 'rowheader'
        ? cell.textContent?.trim()
        : cell.lastElementChild?.textContent?.trim()
    )).toEqual([
      'ALFA',
      '$123.45',
      '$0.05',
      '5',
      '$123.45',
      '0.50'
    ]);
  });

  it('includes labels for every metric in the compact responsive row layout', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.market-row__label'),
      (label: HTMLElement) => label.textContent?.trim()
    );

    expect(labels).toEqual([
      'Last price',
      'Bid-ask spread',
      'Trading volume',
      'VWAP',
      'Order-book imbalance'
    ]);
    expect(fixture.componentInstance.itemSize()).toBe(52);
  });

  it('sizes the table to its final row when the complete list fits', () => {
    const table = fixture.nativeElement.querySelector('.table-scroll') as HTMLElement;

    expect(fixture.componentInstance.tableMaxHeight()).toBe(100);
    expect(table.style.maxHeight).toBe('100px');

    metrics.set(Array.from({ length: 50 }, (_, index) =>
      emptyMetric(`INST${String(index + 1).padStart(2, '0')}`)
    ));
    fixture.detectChanges();

    expect(fixture.componentInstance.tableMaxHeight()).toBe(2_648);
    expect(table.style.maxHeight).toBe('2648px');
  });

  it('virtualizes a fifty-instrument list and reveals the requested rows while scrolling', async () => {
    metrics.set(
      Array.from({ length: 50 }, (_, index) =>
        emptyMetric(`INST${String(index + 1).padStart(2, '0')}`)
      )
    );
    settings.set({ ...settings(), instrumentCount: 50 });
    fixture.detectChanges();

    viewport.checkViewportSize();
    fixture.detectChanges();
    await fixture.whenStable();

    let rows = fixture.nativeElement.querySelectorAll('.market-row');
    expect(rows.length).toBeLessThan(50);
    expect(rows[0].textContent).toContain('INST01');
    expect(fixture.nativeElement.querySelector('.market-header')).not.toBeNull();

    viewport.scrollToIndex(40);
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();
    await fixture.whenStable();
    rows = fixture.nativeElement.querySelectorAll('.market-row');
    expect(Array.from(rows, (row: HTMLElement) => row.textContent).join(' '))
      .toContain('INST41');
  });

  it('preserves scroll position on metric updates and Pause/Resume', async () => {
    const instruments = Array.from({ length: 50 }, (_, index) =>
      emptyMetric(`INST${String(index + 1).padStart(2, '0')}`)
    );
    metrics.set(instruments);
    settings.set({ ...settings(), instrumentCount: 50 });
    fixture.detectChanges();

    viewport.scrollToIndex(30);
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();
    const scrollPosition = viewport.measureScrollOffset('top');

    metrics.set(instruments.map((entry, index) => ({
      ...entry,
      volume: index + 1
    })));
    fixture.detectChanges();
    expect(viewport.measureScrollOffset('top')).toBe(scrollPosition);

    status.set('running');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.toggle-button') as HTMLButtonElement).click();
    status.set('paused');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.toggle-button') as HTMLButtonElement).click();
    expect(viewport.measureScrollOffset('top')).toBe(scrollPosition);
  });

  it('clamps the virtual scroll position when settings reduce instrument count', () => {
    metrics.set(Array.from({ length: 50 }, (_, index) =>
      emptyMetric(`INST${String(index + 1).padStart(2, '0')}`)
    ));
    settings.set({ ...settings(), instrumentCount: 50 });
    fixture.detectChanges();

    viewport.scrollToIndex(40);
    fixture.detectChanges();

    settings.set({ ...settings(), instrumentCount: 4 });
    metrics.set(Array.from({ length: 4 }, (_, index) =>
      emptyMetric(`INST${String(index + 1).padStart(2, '0')}`)
    ));
    fixture.detectChanges();

    expect(viewport.measureScrollOffset('top')).toBeLessThanOrEqual(4 * 52);
    expect(fixture.nativeElement.textContent).toContain('INST04');
  });

  it('shows initializing, running, paused and error states with error details', () => {
    const statusElement = (): HTMLElement =>
      fixture.nativeElement.querySelector('.status');

    expect(statusElement().textContent).toContain('Initializing');
    status.set('running');
    fixture.detectChanges();
    expect(statusElement().textContent).toContain('Running');

    status.set('paused');
    fixture.detectChanges();
    expect(statusElement().textContent).toContain('Paused');

    status.set('error');
    error.set('Unable to load market data');
    fixture.detectChanges();
    expect(statusElement().textContent).toContain('Error');
    expect(fixture.nativeElement.textContent).toContain(
      'Unable to load market data'
    );
  });

  it('pauses and resumes through MarketService without changing dashboard state', () => {
    const button = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('.toggle-button');

    status.set('running');
    fixture.detectChanges();
    expect(button().textContent.trim()).toBe('Pause');
    button().click();
    expect(pause).toHaveBeenCalledOnce();

    status.set('paused');
    fixture.detectChanges();
    expect(button().textContent.trim()).toBe('Resume');
    button().click();
    expect(resume).toHaveBeenCalledOnce();
  });
});
