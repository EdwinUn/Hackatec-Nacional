import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth/auth.guard';
import { AuthService } from './core/auth/auth.service';
import { isMobileViewport } from './core/services/layout.service';
import { Shell } from './layout/shell';

const MANAGERS = roleGuard('supervisor', 'admin');

/** Entry point: staff go to their work home; citizens on a phone to the simple home; desktop to the dashboard. */
function homeRedirect(): string {
  const auth = inject(AuthService);
  if (auth.isLoggedIn()) return auth.homeUrl();
  return isMobileViewport() ? '/inicio' : '/resumen';
}

export const routes: Routes = [
  {
    path: 'login',
    title: 'Acceso para personal · Atl-Monitor',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: '',
    component: Shell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: homeRedirect },
      // ── Citizens (phone, no session) ───────────────────────────────────────
      { path: 'inicio', title: 'Inicio · Atl-Monitor', loadComponent: () => import('./features/citizen/citizen-home-page').then((m) => m.CitizenHomePage) },
      { path: 'avisos', title: 'Avisos · Atl-Monitor', loadComponent: () => import('./features/citizen/public-alerts-page').then((m) => m.PublicAlertsPage) },
      { path: 'boyas/conoce', title: 'Conoce la boya · Atl-Monitor', loadComponent: () => import('./features/citizen/buoy-explainer-page').then((m) => m.BuoyExplainerPage) },
      { path: 'reportar/mis-reportes', title: 'Mis reportes · Atl-Monitor', loadComponent: () => import('./features/reports/my-reports-page').then((m) => m.MyReportsPage) },
      // ── Public (dashboard) ─────────────────────────────────────────────────
      { path: 'resumen', title: 'Resumen ejecutivo · Atl-Monitor', loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage) },
      { path: 'mapa', title: 'Vista satelital · Atl-Monitor', loadComponent: () => import('./features/satellite/satellite-page').then((m) => m.SatellitePage) },
      { path: 'telemetria', redirectTo: 'boyas' },
      { path: 'boyas', title: 'Boyas · Atl-Monitor', loadComponent: () => import('./features/buoys/buoys-page').then((m) => m.BuoysPage) },
      { path: 'boyas/:id', title: 'Boya en 3D · Atl-Monitor', loadComponent: () => import('./features/buoys/buoy-detail-page').then((m) => m.BuoyDetailPage) },
      { path: 'alertas', title: 'Alertamiento temprano · Atl-Monitor', loadComponent: () => import('./features/alerts/alerts-page').then((m) => m.AlertsPage) },
      { path: 'analitica', pathMatch: 'full', redirectTo: 'analitica/pronostico' },
      { path: 'analitica/:tab', title: 'Analítica predictiva · Atl-Monitor', loadComponent: () => import('./features/predictive/predictive-page').then((m) => m.PredictivePage) },
      { path: 'reportar', title: 'Reportar contaminación · Atl-Monitor', loadComponent: () => import('./features/reports/report-page').then((m) => m.ReportPage) },
      { path: 'reportar/seguimiento/:folio', title: 'Seguimiento de reporte · Atl-Monitor', loadComponent: () => import('./features/reports/report-track-page').then((m) => m.ReportTrackPage) },

      // ── Staff (login required) ─────────────────────────────────────────────
      {
        path: 'operaciones',
        canActivate: [authGuard],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'mis-tareas' },
          { path: 'bandeja', title: 'Mi bandeja · Atl-Monitor', loadComponent: () => import('./features/operator/bandeja-page').then((m) => m.BandejaPage) },
          { path: 'mis-tareas', title: 'Mis tareas · Atl-Monitor', loadComponent: () => import('./features/ops/my-tasks-page').then((m) => m.MyTasksPage) },
          { path: 'tarea/:id', title: 'Orden de trabajo · Atl-Monitor', loadComponent: () => import('./features/ops/task-page').then((m) => m.TaskPage) },
          { path: 'reportes', title: 'Reportes ciudadanos · Atl-Monitor', canActivate: [MANAGERS], loadComponent: () => import('./features/ops/inbox-page').then((m) => m.InboxPage) },
          { path: 'ordenes', title: 'Órdenes de trabajo · Atl-Monitor', canActivate: [MANAGERS], loadComponent: () => import('./features/ops/orders-page').then((m) => m.OrdersPage) },
          { path: 'equipo', title: 'Desempeño del equipo · Atl-Monitor', canActivate: [MANAGERS], loadComponent: () => import('./features/ops/team-page').then((m) => m.TeamPage) },
          { path: 'admin/usuarios', title: 'Usuarios · Atl-Monitor', canActivate: [roleGuard('admin')], loadComponent: () => import('./features/ops/users-page').then((m) => m.UsersPage) },
        ],
      },
    ],
  },
  { path: '**', redirectTo: homeRedirect },
];
