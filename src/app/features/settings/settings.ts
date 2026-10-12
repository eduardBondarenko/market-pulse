import {
  ChangeDetectionStrategy,
  Component,
  inject
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';

import {
  DEFAULT_SETTINGS
} from '../../core/models/producer-settings.model';
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

  apply(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const settings = this.form.getRawValue();

    this.marketService.applySettings(settings);

    this.form.markAsPristine();
  }
}
