import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard')
        .then((m) => m.Dashboard),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings')
        .then((m) => m.Settings),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
