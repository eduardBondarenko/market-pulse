import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, ProducerSettings } from '../../core/models/producer-settings.model';
import { MarketService, MarketServiceEvent } from '../../core/services/market';
import { Settings } from './settings';

describe('Settings', () => {
  let component: Settings;
  let fixture: ComponentFixture<Settings>;
  let applied: ReturnType<typeof vi.fn>;
  let settings: ReturnType<typeof signal<ProducerSettings>>;
  let runId: ReturnType<typeof signal<number>>;
  let lastEvent: ReturnType<typeof signal<MarketServiceEvent | null>>;

  beforeEach(async () => {
    settings = signal({ ...DEFAULT_SETTINGS });
    runId = signal(1);
    lastEvent = signal<MarketServiceEvent | null>(null);
    applied = vi.fn((next: ProducerSettings) => {
      settings.set({ ...next });
      runId.update((id) => id + 1);
    });

    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        {
          provide: MarketService,
          useValue: {
            activeSettings: settings.asReadonly(),
            settings: settings.asReadonly(),
            runId: runId.asReadonly(),
            lastEvent: lastEvent.asReadonly(),
            applySettings: applied
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  function input(id: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
  }

  function setInput(id: string, value: string): void {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  function applyButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  }

  it('renders exactly one action button, Apply', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent.trim()).toBe('Apply');
    expect(applyButton().disabled).toBe(true);
  });

  it('enables Apply as soon as valid values differ and disables it when restored', () => {
    setInput('instrumentCount', '6');
    expect(applyButton().disabled).toBe(false);

    setInput('instrumentCount', '5');
    expect(applyButton().disabled).toBe(true);
  });

  it('shows validation errors immediately while typing invalid values', () => {
    setInput('instrumentCount', '0');

    expect(component.form.controls.instrumentCount.invalid).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'Enter an integer between 1 and 50.'
    );
    expect(applyButton().disabled).toBe(true);
  });

  it('applies valid changes and waits for matching Worker confirmation', async () => {
    setInput('instrumentCount', '6');
    applyButton().click();
    fixture.detectChanges();

    expect(applied).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      instrumentCount: 6
    });
    expect(applyButton().disabled).toBe(true);
    expect(applyButton().textContent).toContain('Applying');

    lastEvent.set({
      id: 1,
      type: 'settings-applied',
      runId: runId(),
      settings: { ...DEFAULT_SETTINGS, instrumentCount: 6 }
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(applyButton().disabled).toBe(true);
    expect(applyButton().textContent.trim()).toBe('Apply');
  });

  it('allows retry after Worker error without treating failed values as applied', async () => {
    setInput('instrumentCount', '6');
    applyButton().click();
    fixture.detectChanges();

    lastEvent.set({
      id: 1,
      type: 'error',
      runId: runId(),
      message: 'Worker failed'
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(applyButton().disabled).toBe(false);
    expect(applyButton().textContent.trim()).toBe('Apply');
    expect(component.hasChanges()).toBe(true);
  });

  it('validates every numeric setting against its supported range', () => {
    component.form.controls.updatesPerBatch.setValue(1001);
    component.form.controls.batchInterval.setValue(49);
    fixture.detectChanges();

    expect(component.form.invalid).toBe(true);
    expect(applyButton().disabled).toBe(true);

    component.form.controls.updatesPerBatch.setValue(1000);
    component.form.controls.batchInterval.setValue(50);
    fixture.detectChanges();
    expect(component.form.valid).toBe(true);
  });
});
