import { HttpClient, HttpContext } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { APP_CONFIG } from '../config/app-config';
import { SILENT_ERRORS } from '../interceptors/api-error.interceptor';
import { DeviceTelemetryDto, TELEMETRY_LIVE_MS, TelemetryPacket, deviceCodeFor } from '../models/telemetry.models';
import { LiveStreamService } from './live-stream.service';

/**
 * Last packet of each buoy's ESP32. Fed by the `device_telemetry` frames of `/ws/live`
 * (the ESP32 / Wokwi posts to `POST /telemetry/iot`) and seeded with `GET /devices/{code}/telemetry/latest`.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;
  private readonly live = inject(LiveStreamService);

  private readonly _packets = signal<Record<string, TelemetryPacket>>({});
  readonly packets = this._packets.asReadonly();
  /** Ticks every second so «live» and «hace X» expire without new packets. */
  private readonly now = signal(Date.now());
  private readonly loaded = new Set<string>();

  constructor() {
    this.live.raw$.pipe(takeUntilDestroyed()).subscribe((m) => {
      if (m.type !== 'device_telemetry') return;
      const d = m.data as DeviceTelemetryDto;
      if (d.code) this.set(d.code, d, Date.now());
    });
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  packet(code: string) {
    return computed(() => this._packets()[deviceCodeFor(code)] ?? null);
  }

  /** `true` while the last packet is recent enough. */
  isLive(code: string) {
    return computed(() => {
      const p = this._packets()[deviceCodeFor(code)];
      return !!p && this.now() - p.receivedAt < TELEMETRY_LIVE_MS;
    });
  }

  /** Seconds since the last packet (`null` if none). */
  ageSeconds(code: string) {
    return computed(() => {
      const p = this._packets()[deviceCodeFor(code)];
      return p ? Math.max(0, Math.round((this.now() - p.receivedAt) / 1000)) : null;
    });
  }

  /** Loads the last stored packet once, so the panel is not empty before the first live one. */
  ensureLoaded(code: string): void {
    const key = deviceCodeFor(code);
    if (this.loaded.has(key)) return;
    this.loaded.add(key);
    this.http.get<DeviceTelemetryDto>(`${this.base}/devices/${key}/telemetry/latest`, { context: new HttpContext().set(SILENT_ERRORS, true) }).subscribe({
      next: (d) => {
        // Stored packet: shown, but not «live» (receivedAt = its own timestamp).
        const at = Date.parse(d.ts);
        if (!this._packets()[key]) this.set(key, d, Number.isFinite(at) ? at : 0);
      },
      error: () => undefined, // no packet yet (404) or offline
    });
  }

  private set(code: string, d: DeviceTelemetryDto, receivedAt: number): void {
    this._packets.update((all) => ({ ...all, [deviceCodeFor(code)]: { ...d, receivedAt } }));
  }
}

