import { HttpClient, HttpContext } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { APP_CONFIG } from '../config/app-config';
import { mockTelemetry, mockTelemetryHistory } from '../mock/telemetry.mock';
import { SILENT_ERRORS } from '../interceptors/api-error.interceptor';
import { DeviceTelemetryDto, TELEMETRY_BURST_MS, TelemetryPacket, deviceCodeFor, liveWindowMs } from '../models/telemetry.models';
import { LiveStreamService } from './live-stream.service';

/**
 * Last packet of each buoy's ESP32. Fed by the `device_telemetry` frames of `/ws/live`
 * (the ESP32 in Wokwi publishes by MQTT; see API.md) and seeded with `GET /devices/{code}/telemetry/latest`.
 * With `useMocks` the packets come from `core/mock/telemetry.mock.ts` (one every 15 s).
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly http = inject(HttpClient);
  private readonly cfg = inject(APP_CONFIG);
  private readonly base = this.cfg.apiBaseUrl;
  private readonly live = inject(LiveStreamService);

  private readonly _packets = signal<Record<string, TelemetryPacket>>({});
  readonly packets = this._packets.asReadonly();
  /** Ticks every second so «live» and «hace X» expire without new packets. */
  private readonly now = signal(Date.now());
  private readonly loaded = new Set<string>();
  /** Buoys with at least one packet from `/ws/live` (their `receivedAt` is a real arrival time). */
  private readonly streamed = new Set<string>();

  constructor() {
    this.live.raw$.pipe(takeUntilDestroyed()).subscribe((m) => {
      if (m.type !== 'device_telemetry') return;
      const d = m.data as DeviceTelemetryDto;
      if (d.code) this.set(d.code, d, Date.now(), true);
    });
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    // Mock mode: every loaded buoy «sends» a packet every 15 s, as the firmware would.
    const mockTimer = this.cfg.useMocks ? setInterval(() => this.loaded.forEach((c) => this.set(c, mockTelemetry(c, Date.now()), Date.now(), true)), 15_000) : undefined;
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearInterval(mockTimer);
    });
  }

  packet(code: string) {
    return computed(() => this._packets()[deviceCodeFor(code)] ?? null);
  }

  /** `true` while the last packet is recent enough for the rhythm at which they arrive (see `liveWindowMs`). */
  isLive(code: string) {
    return computed(() => {
      const p = this._packets()[deviceCodeFor(code)];
      return !!p && this.now() - p.receivedAt < liveWindowMs(p);
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
    if (this.cfg.useMocks) {
      this.set(key, mockTelemetry(key, Date.now()), Date.now(), true);
      return;
    }
    this.http.get<DeviceTelemetryDto>(`${this.base}/devices/${key}/telemetry/latest`, { context: new HttpContext().set(SILENT_ERRORS, true) }).subscribe({
      next: (d) => {
        // Stored packet: shown, but not «live» (receivedAt = its own timestamp).
        const at = Date.parse(d.ts);
        if (!this._packets()[key]) this.set(key, d, Number.isFinite(at) ? at : 0);
      },
      error: () => undefined, // no packet yet (404) or offline
    });
  }

  /**
   * Stored packets of a buoy since `since` (`GET /devices/{code}/telemetry`), most recent first and at
   * most `limit` (1–1000). Errors are not toasted: the caller shows its own state.
   */
  history(code: string, since: Date, limit = 1000): Observable<DeviceTelemetryDto[]> {
    const key = deviceCodeFor(code);
    if (this.cfg.useMocks) return of(mockTelemetryHistory(key, since.getTime(), Date.now(), limit)).pipe(delay(250));
    return this.http.get<DeviceTelemetryDto[]>(`${this.base}/devices/${key}/telemetry`, {
      params: { since: since.toISOString(), limit },
      context: new HttpContext().set(SILENT_ERRORS, true),
    });
  }

  /** `streamed`: it came by `/ws/live` (not from the stored latest), so it tells the real rhythm. */
  private set(code: string, d: DeviceTelemetryDto, receivedAt: number, streamed = false): void {
    const key = deviceCodeFor(code);
    this._packets.update((all) => {
      const prev = all[key];
      let intervalMs = prev?.intervalMs;
      if (streamed && prev && this.streamed.has(key)) {
        const gap = receivedAt - prev.receivedAt;
        if (gap >= TELEMETRY_BURST_MS) intervalMs = gap; // a burst of queued packets keeps the last rhythm
      }
      return { ...all, [key]: { ...d, receivedAt, intervalMs } };
    });
    if (streamed) this.streamed.add(key);
  }
}

