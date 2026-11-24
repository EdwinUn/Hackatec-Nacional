import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth/auth.guard';
import { Shell } from './layout/shell';

const MANAGERS = roleGuard('supervisor', 'admin');

export const routes: Routes = [
  {
    path: 'login',
    title: 'Acceso para personal · Río Monitor',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: '',
    component: Shell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'resumen' },
      // ── Public (citizens) ──────────────────────────────────────────────────
      { path: 'resumen', title: 'Resumen ejecutivo · Río Monitor', loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage) },
      { path: 'mapa', title: 'Vista satelital · Río Monitor', loadComponent: () => import('./features/satellite/satellite-page').then((m) => m.SatellitePage) },
      { path: 'alertas', title: 'Alertamiento temprano · Río Monitor', loadComponent: () => import('./features/alerts/alerts-page').then((m) => m.AlertsPage) },
      { path: 'analitica', pathMatch: 'full', redirectTo: 'analitica/pronostico' },
      { path: 'analitica/:tab', title: 'Analítica predictiva · Río Monitor', loadComponent: () => import('./features/predictive/predictive-page').then((m) => m.PredictivePage) },
      { path: 'reportar', title: 'Reportar contaminación · Río Monitor', loadComponent: () => import('./features/reports/report-page').then((m) => m.ReportPage) },
      { path: 'reportar/seguimiento/:folio', title: 'Seguimiento de reporte · Río Monitor', loadComponent: () => import('./features/reports/report-track-page').then((m) => m.ReportTrackPage) },

      // ── Staff (login required) ─────────────────────────────────────────────
      {
        path: 'operaciones',
        canActivate: [authGuard],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'mis-tareas' },
          { path: 'mis-tareas', title: 'Mis tareas · Río Monitor', loadComponent: () => import('./features/ops/my-tasks-page').then((m) => m.MyTasksPage) },
          { path: 'tarea/:id', title: 'Orden de trabajo · Río Monitor', loadComponent: () => import('./features/ops/task-page').then((m) => m.TaskPage) },
          { path: 'reportes', title: 'Reportes ciudadanos · Río Monitor', canActivate: [MANAGERS], loadComponent: () => import('./features/ops/inbox-page').then((m) => m.InboxPage) },
          { path: 'ordenes', title: 'Órdenes de trabajo · Río Monitor', canActivate: [MANAGERS], loadComponent: () => import('./features/ops/orders-page').then((m) => m.OrdersPage) },
          { path: 'equipo', title: 'Desempeño del equipo · Río Monitor', canActivate: [MANAGERS], loadComponent: () => import('./features/ops/team-page').then((m) => m.TeamPage) },
          { path: 'admin/usuarios', title: 'Usuarios · Río Monitor', canActivate: [roleGuard('admin')], loadComponent: () => import('./features/ops/users-page').then((m) => m.UsersPage) },
        ],
      },
    ],
  },
  { path: '**', redirectTo: 'resumen' },
];
