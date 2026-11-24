import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { merge } from 'rxjs';
import { OpsApi } from '../api/ops-api';
import { AuthService } from '../auth/auth.service';
import { LiveStreamService } from './live-stream.service';

const PREF_KEY = 'rm.native-notifications';
const CHANNEL = 'rio-alertas';

/**
 * System notifications on the phone (Capacitor, Android):
 * - critical alerts from the live stream (everyone with notifications on),
 * - work orders assigned to the logged-in technician.
 * Works while the app is open or recently in the background; with the app closed it would
 * need push notifications (FCM) from the backend — out of scope for the prototype.
 * On the web it does nothing (the Shell toast already covers it).
 */
@Injectable({ providedIn: 'root' })
export class NativeAlertsService {
  private readonly live = inject(LiveStreamService);
  private readonly ops = inject(OpsApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);

  readonly supported = Capacitor.isNativePlatform();
  readonly enabled = signal(this.readPref());
  private started = false;
  private nextId = 1;

  /** Called once from the Shell. */
  start(): void {
    if (!this.supported || this.started) return;
    this.started = true;

    void LocalNotifications.createChannel({ id: CHANNEL, name: 'Alertas del río', description: 'Alertas críticas y tareas asignadas', importance: 5, visibility: 1, vibration: true }).catch(() => undefined);
    void LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const url = (a.notification.extra as { url?: string } | undefined)?.url;
      if (url) this.zone.run(() => void this.router.navigateByUrl(url));
    });
    if (this.enabled()) void this.ensurePermission();

    merge(this.live.events$, this.ops.events$).subscribe((e) => {
      if (!this.enabled()) return;
      if (e.type === 'alert' && e.data.severity === 'critical' && e.data.status === 'open') {
        void this.notify(`⚠ Alerta crítica · ${e.data.station_name}`, e.data.message, '/alertas');
      }
      if (e.type === 'work_order_assigned' && e.data.assigned_to && e.data.assigned_to === this.auth.user()?.id) {
        void this.notify(`Nueva tarea: ${e.data.folio}`, e.data.title, `/operaciones/tarea/${e.data.id}`);
      }
    });
  }

  async setEnabled(on: boolean): Promise<boolean> {
    if (on && !(await this.ensurePermission())) on = false;
    this.enabled.set(on);
    try {
      localStorage.setItem(PREF_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    return on;
  }

  private async ensurePermission(): Promise<boolean> {
    try {
      const p = await LocalNotifications.checkPermissions();
      if (p.display === 'granted') return true;
      return (await LocalNotifications.requestPermissions()).display === 'granted';
    } catch {
      return false;
    }
  }

  private async notify(title: string, body: string, url: string): Promise<void> {
    try {
      await LocalNotifications.schedule({
        notifications: [{ id: this.nextId++, title, body, channelId: CHANNEL, extra: { url } }],
      });
    } catch {
      /* permission revoked or plugin unavailable */
    }
  }

  private readPref(): boolean {
    try {
      return localStorage.getItem(PREF_KEY) !== '0';
    } catch {
      return true;
    }
  }
}
