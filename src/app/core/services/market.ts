
import { Injectable, signal } from '@angular/core';

import {
  DEFAULT_SETTINGS,
  ProducerSettings
} from '../models/producer-settings.model';

@Injectable({
  providedIn: 'root'
})
export class MarketService {

  private readonly _activeSettings =
    signal<ProducerSettings>({ ...DEFAULT_SETTINGS });

  readonly activeSettings = this._activeSettings.asReadonly();

  private readonly _runId = signal(1);

  readonly runId = this._runId.asReadonly();

  applySettings(settings: ProducerSettings): void {
    this._runId.update(id => id + 1);

    this._activeSettings.set({ ...settings });

    console.log('New run:', this.runId());
    console.log('Active settings:', this.activeSettings());
  }
}
