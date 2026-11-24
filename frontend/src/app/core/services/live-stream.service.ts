import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Subject } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { MockBackend } from '../mock/mock-backend';
import { LiveEvent, LiveStatus } from '../models/rio.models';
import { mapLiveEvent } from '../api/backend-mappers';
import { BeEnvelope } from '../api/backend.types';
import { FiltersService } from './filters.service';
import { StationsService } from './stations.service';

/** Reconnect delay: 1 s, 2 s, 4 s … capped at 30 s. */
export function backoffDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

/**
 * Live stream (`ws://…/ws/live[?station_id=<uuid>]`) with automatic reconnection.
 * - Station changes send `{ "type": "subscribe", "station_id": … }` without dropping the socket.
 * - `hello` / `ping` are ignored; everything else is exposed through `events$`.
 * - `reconnected$` fires after every re-connection so views can re-query `/dashboard/overview`.
 * With `useMocks` the same events come from `MockBackend`.
 */
@Injectable({ providedIn: 'root' })
export class LiveStreamService {
  private readonly cfg = inject(APP_CONFIG);
  private readonly filters = inject(FiltersService);
  private readonly mock = inject(MockBackend);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stations = inject(StationsService);

  readonly status = signal<LiveStatus>('disconnected');
  readonly events$ = new Subject<LiveEvent>();
  readonly reconnected$ = new Subject<void>();

  private ws?: WebSocket;
  private attempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private everConnected = false;
  private closedByUs = false;

  constructor() {
    if (this.cfg.useMocks) {
      this.status.set('connected');
      this.mock.startLive();
      const sub = this.mock.events$.subscribe((e) => this.dispatch(e));
      this.destroyRef.onDestroy(() => {
        sub.unsubscribe();
        this.mock.stopLive();
      });
      return;
    }

    this.connect();
    this.destroyRef.onDestroy(() => {
      this.closedByUs = true;
      clearTimeout(this.retryTimer);
      this.ws?.close();
    });

    // Re-subscribe when the station selector changes (no reconnection).
    effect(() => {
      const id = this.filters.stationId();
      untracked(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'subscribe', station_id: id }));
      });
    });
  }

  private connect(): void {
    const id = untracked(() => this.filters.stationId());
    const url = this.cfg.wsUrl + (id ? `?station_id=${encodeURIComponent(id)}` : '');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.status.set('connected');
      if (this.everConnected) this.reconnected$.next();
      this.everConnected = true;
    };
    ws.onmessage = (m) => {
      try {
        // The backend sends `{ type, station_id, ts, data }` in its own field names (API.md).
        const event = mapLiveEvent(JSON.parse(String(m.data)) as BeEnvelope, (id) => this.stations.name(id));
        if (event) this.dispatch(event);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (!this.closedByUs) this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry(): void {
    this.status.set('reconnecting');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), backoffDelay(this.attempt++));
  }

  private dispatch(e: LiveEvent): void {
    if (e.type === 'hello' || e.type === 'ping') return;
    const station = this.filters.stationId();
    if (station && (e.data as { station_id?: string }).station_id !== station) return;
    this.events$.next(e);
  }
}
