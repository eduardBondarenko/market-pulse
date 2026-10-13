import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { startWith } from 'rxjs';

import { ProducerSettings } from '../../core/models/producer-settings.model';
import { MarketService } from '../../core/services/market';

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Settings {
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly marketService = inject(MarketService);
  private readonly appliedSettings = signal<ProducerSettings>({
    ...this.marketService.activeSettings()
  });
  private readonly pendingApplyRunId = signal<number | null>(null);

  readonly form = this.fb.group({
    instrumentCount: [
      this.marketService.activeSettings().instrumentCount,
      [
        Validators.required,
        Validators.min(1),
        Validators.max(50),
        Validators.pattern(/^\d+$/)
      ]
    ],

    updatesPerBatch: [
      this.marketService.activeSettings().updatesPerBatch,
      [
        Validators.required,
        Validators.min(1),
        Validators.max(1000),
        Validators.pattern(/^\d+$/)
      ]
    ],

    batchInterval: [
      this.marketService.activeSettings().batchInterval,
      [
        Validators.required,
        Validators.min(50),
        Validators.max(2000),
        Validators.pattern(/^\d+$/)
      ]
    ]
  });

  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() }
  );
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status }
  );

  readonly hasChanges = computed(() => {
    const value = this.formValue();
    const applied = this.appliedSettings();

    return value.instrumentCount !== applied.instrumentCount ||
      value.updatesPerBatch !== applied.updatesPerBatch ||
      value.batchInterval !== applied.batchInterval;
  });

  readonly isApplying = computed(() => {
    const pendingRunId = this.pendingApplyRunId();
    const event = this.marketService.lastEvent();

    return pendingRunId !== null && !(
      event?.runId === pendingRunId &&
      (event.type === 'settings-applied' || event.type === 'error')
    );
  });

  readonly canApply = computed(
    () => this.formStatus() === 'VALID' && this.hasChanges() && !this.isApplying()
  );

  constructor() {
    effect(() => {
      const pendingRunId = this.pendingApplyRunId();
      const event = this.marketService.lastEvent();

      if (pendingRunId === null || event?.runId !== pendingRunId) {
        return;
      }

      if (event.type === 'settings-applied') {
        this.appliedSettings.set({ ...event.settings });
        this.pendingApplyRunId.set(null);
      } else if (event.type === 'error') {
        this.pendingApplyRunId.set(null);
      }
    });
  }

  apply(): void {
    if (!this.canApply()) {
      this.form.markAllAsTouched();
      return;
    }

    const settings = this.form.getRawValue();
    this.marketService.applySettings(settings);
    this.pendingApplyRunId.set(this.marketService.runId());
  }
}
