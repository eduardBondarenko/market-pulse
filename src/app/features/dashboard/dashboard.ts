import {
  ChangeDetectionStrategy,
  Component,
  inject
} from '@angular/core';

import { MarketService } from '../../core/services/market';

@Component({
  selector: 'app-dashboard',
  imports: [],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Dashboard {
  readonly marketService = inject(MarketService);
}
