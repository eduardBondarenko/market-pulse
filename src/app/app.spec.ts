import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { MarketService, MarketServiceEvent } from './core/services/market';
import { NotificationService } from './core/services/notification';
import { ToastContainer } from './shared/toast-container/toast-container';
import { NOTIFICATION_EXIT_MS } from './core/services/notification';

@Component({
  template: 'Dashboard route'
})
class DashboardRouteStub {}

@Component({
  template: 'Settings route'
})
class SettingsRouteStub {}

describe('App', () => {
  let marketEvent: ReturnType<typeof signal<MarketServiceEvent | null>>;

  beforeEach(async () => {
    marketEvent = signal<MarketServiceEvent | null>(null);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: 'dashboard', component: DashboardRouteStub },
          { path: 'settings', component: SettingsRouteStub }
        ]),
        {
          provide: MarketService,
          useValue: { lastEvent: marketEvent.asReadonly() }
        }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the application title', () => {
    const fixture = TestBed.createComponent(App);

    fixture.detectChanges();

    const element: HTMLElement =
      fixture.nativeElement;

    expect(element.textContent)
      .toContain('Market Pulse');

  });

  it('keeps the toast container and active notifications across route navigation', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const notificationService = TestBed.inject(NotificationService);
    vi.useFakeTimers();
    const toastId = notificationService.add('success', 'Settings applied.');
    notificationService.add('error', 'Market error: Worker failed');

    await router.navigateByUrl('/dashboard');
    fixture.detectChanges();
    const toastComponent = fixture.debugElement.query(
      By.directive(ToastContainer)
    ).componentInstance as ToastContainer;
    expect(toastComponent.service()).toBe(notificationService);
    const toastContainer = fixture.nativeElement.querySelector(
      'app-toast-container'
    );
    expect(toastContainer.textContent).toContain('Settings applied.');
    expect(toastContainer.querySelector('[role="status"]')?.getAttribute('aria-live'))
      .toBe('polite');
    expect(toastContainer.querySelector('[role="alert"]')?.getAttribute('aria-live'))
      .toBe('assertive');

    await router.navigateByUrl('/settings');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('app-toast-container')
    ).toBe(toastContainer);
    expect(toastContainer.textContent).toContain('Settings applied.');
    expect(notificationService.notifications()[0].id).toBe(toastId);

    const closeButton = toastContainer.querySelector('button') as HTMLButtonElement;
    expect(closeButton.getAttribute('aria-label')).toContain('Dismiss notification');
    closeButton.click();
    fixture.detectChanges();
    expect(toastContainer.textContent).toContain('Settings applied.');
    expect(notificationService.notifications()[0].exiting).toBe(true);
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    fixture.detectChanges();
    expect(toastContainer.textContent).not.toContain('Settings applied.');

    const remainingCloseButton = toastContainer.querySelector(
      'button'
    ) as HTMLButtonElement;
    remainingCloseButton.click();
    fixture.detectChanges();
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-toast-container aside')).toBeNull();
    expect(notificationService.notifications()).toEqual([]);
  });

  it('removes a service-generated final notification from the rendered DOM', () => {
    const fixture = TestBed.createComponent(App);
    const notificationService = TestBed.inject(NotificationService);
    vi.useFakeTimers();
    marketEvent.set({
      id: 1,
      type: 'error',
      runId: 1,
      message: 'Worker failed'
    });
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(notificationService.notifications()).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Market error: Worker failed');

    const closeButton = fixture.nativeElement.querySelector(
      '.toast__close'
    ) as HTMLButtonElement;
    closeButton.click();
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(notificationService.notifications()[0].exiting).toBe(true);
    expect(fixture.nativeElement.querySelector('.toast')).not.toBeNull();
    vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    fixture.detectChanges();
    expect(notificationService.notifications()).toEqual([]);
    expect(fixture.nativeElement.querySelector('app-toast-container aside')).toBeNull();
  });
});
