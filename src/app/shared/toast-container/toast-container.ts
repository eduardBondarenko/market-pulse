import {
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';

import { Notification, NotificationService } from '../../core/services/notification';

@Component({
  selector: 'app-toast-container',
  templateUrl: './toast-container.html',
  styleUrl: './toast-container.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToastContainer {
  readonly service = input.required<NotificationService>();
  private readonly changeDetector = inject(ChangeDetectorRef);

  dismiss(notification: Notification): void {
    this.service().dismiss(notification.id);
    this.changeDetector.markForCheck();
  }
}
