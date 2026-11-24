import { Routes } from '@angular/router';
import { Shell } from './layout/shell';

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'resumen' },
      { path: 'resumen', title: 'Resumen ejecutivo · Río Monitor', loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage) },
      { path: 'mapa', title: 'Vista satelital · Río Monitor', loadComponent: () => import('./features/satellite/satellite-page').then((m) => m.SatellitePage) },
      { path: 'alertas', title: 'Alertamiento temprano · Río Monitor', loadComponent: () => import('./features/alerts/alerts-page').then((m) => m.AlertsPage) },
      { path: 'analitica', pathMatch: 'full', redirectTo: 'analitica/pronostico' },
      { path: 'analitica/:tab', title: 'Analítica predictiva · Río Monitor', loadComponent: () => import('./features/predictive/predictive-page').then((m) => m.PredictivePage) },
    ],
  },
  { path: '**', redirectTo: 'resumen' },
];
