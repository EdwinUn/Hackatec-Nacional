import { Injectable, computed, effect, inject, linkedSignal, untracked } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, map } from 'rxjs';
import { RioApi } from '../../core/api/rio-api';
import { Buoy } from '../../core/models/buoy.models';
import { Alert, DashboardOverview, SensorHealth, WasteType } from '../../core/models/rio.models';
import { DeviceTelemetryDto, TelemetryPacket, deviceCodeFor } from '../../core/models/telemetry.models';
import { BuoysService } from '../../core/services/buoys.service';
import { FiltersService } from '../../core/services/filters.service';
import { LiveStreamService } from '../../core/services/live-stream.service';
import { StationsService } from '../../core/services/stations.service';
import { TelemetryService } from '../../core/services/telemetry.service';
import { valueOrUndefined } from '../../shared/utils/resource.util';
import { WASTE_TYPES } from '../../shared/utils/wqi.util';

/** Most packets asked to `GET /devices/{code}/telemetry` (the API maximum). */
export const HISTORY_LIMIT = 1000;
const MAX_LIVE = 500;

export interface BuoyView {
  buoy: Buoy;
  /** Normalized device code (`RM-01`). */
  code: string;
  /** Backend station fed by this buoy (`null` if the backend has no station with that code). */
  stationId: string | null;
  packet: TelemetryPacket | null;
  live: boolean;
}

export interface AlertSummary {
  open: number;
  criticalTotal: number;
  /** Most recent open critical alerts of both buoys. */
  critical: Alert[];
}

export interface WasteSummary {
  total_kg: number;
  by_type: { type: WasteType; kg: number; pieces: number }[];
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Keeps the last successful value while a refresh is in flight (no skeleton flicker). */
function keep<T>(source: () => T | undefined) {
  return linkedSignal<T | undefined, T | undefined>({ source, computation: (n, prev) => n ?? prev?.value });
}

/**
 * Page-scoped store of the executive summary. Only the buoys RM-01 and RM-02 (team decision): their
 * ESP32 packets (`TelemetryService`), their stored history for the chart, and the open alerts, waste,
 * WQI and sensor health of their backend stations.
 */
@Injectable()
export class DashboardStore {
  private readonly api = inject(RioApi);
  private readonly filters = inject(FiltersService);
  private readonly live = inject(LiveStreamService);
  private readonly stations = inject(StationsService);
  private readonly telemetry = inject(TelemetryService);
  private readonly buoyList = inject(BuoysService).buoys;

  readonly stationsLoaded = this.stations.loaded;

  /** Backend station id of each buoy, by device code. */
  private readonly stationByCode = computed(() => new Map(this.stations.stations().filter((s) => s.code).map((s) => [deviceCodeFor(s.code!), s.id])));
  readonly codeByStation = computed(() => new Map([...this.stationByCode()].map(([code, id]) => [id, code])));

  /** Per-buoy signals, created once so `buoys` only recomputes when a packet or the live flag changes. */
  private readonly perCode = computed(() =>
    this.buoyList().map((b) => {
      const code = deviceCodeFor(b.code);
      return { buoy: b, code, packet: this.telemetry.packet(code), live: this.telemetry.isLive(code), age: this.telemetry.ageSeconds(code) };
    }),
  );

  readonly buoys = computed<BuoyView[]>(() =>
    this.perCode().map((x) => ({ buoy: x.buoy, code: x.code, stationId: this.stationByCode().get(x.code) ?? null, packet: x.packet(), live: x.live() })),
  );

  /** Seconds since each buoy's last packet (ticks every second; read it only where «hace X» is shown). */
  readonly ages = computed<Record<string, number | null>>(() => Object.fromEntries(this.perCode().map((x) => [x.code, x.age()])));

  readonly codes = computed(() => this.buoyList().map((b) => deviceCodeFor(b.code)), { equal: sameIds });

  /** Buoy shown in «¿Cómo está el agua?» and the chart. Follows the header's station when it is a buoy. */
  private readonly selectedCodeRaw = linkedSignal<string | null, string | null>({
    source: () => this.filters.stationId(),
    computation: (id, prev) => (id ? this.codeByStation().get(id) : undefined) ?? prev?.value ?? null,
  });
  readonly selectedCode = computed(() => {
    const c = this.selectedCodeRaw();
    const codes = this.codes();
    return c && codes.includes(c) ? c : (codes[0] ?? null);
  });
  readonly selected = computed(() => this.buoys().find((b) => b.code === this.selectedCode()) ?? null);
  readonly selectedStationId = computed(() => {
    const c = this.selectedCode();
    return c ? (this.stationByCode().get(c) ?? null) : null;
  });

  private readonly stationIds = computed(
    () => this.codes().map((c) => this.stationByCode().get(c)).filter((x): x is string => !!x),
    { equal: sameIds },
  );

  select(code: string): void {
    this.selectedCodeRaw.set(code);
    const id = this.stationByCode().get(code);
    if (id) this.filters.setStation(id);
  }

  // ── Resources ────────────────────────────────────────────────────────────────
  /** Open alerts are a current state: not limited to the date range. */
  readonly alertsRes = rxResource({
    params: () => (this.stationIds().length ? { ids: this.stationIds(), tick: this.filters.tick() } : undefined),
    stream: ({ params }) =>
      forkJoin(
        params.ids.map((id) =>
          forkJoin({
            open: this.api.alerts({ status: 'open', station_id: id, limit: 1, offset: 0 }),
            critical: this.api.alerts({ status: 'open', severity: 'critical', station_id: id, limit: 3, offset: 0 }),
          }),
        ),
      ).pipe(
        map(
          (list): AlertSummary => ({
            open: list.reduce((a, x) => a + x.open.total, 0),
            criticalTotal: list.reduce((a, x) => a + x.critical.total, 0),
            critical: list.flatMap((x) => x.critical.items).sort((a, b) => b.created_at.localeCompare(a.created_at)),
          }),
        ),
      ),
  });

  readonly wasteRes = rxResource({
    params: () => (this.stationIds().length ? { ids: this.stationIds(), q: this.filters.query(), tick: this.filters.tick() } : undefined),
    stream: ({ params }) =>
      forkJoin(params.ids.map((id) => this.api.waste({ ...params.q, station_id: id }, '1h'))).pipe(
        map((list): WasteSummary => {
          const by_type = WASTE_TYPES.map((type) => {
            const rows = list.map((w) => w.by_type.find((t) => t.type === type));
            return { type, kg: rows.reduce((a, r) => a + (r?.kg ?? 0), 0), pieces: rows.reduce((a, r) => a + (r?.pieces ?? 0), 0) };
          }).filter((t) => t.kg > 0 || t.pieces > 0);
          return { total_kg: by_type.reduce((a, t) => a + t.kg, 0), by_type };
        }),
      ),
  });

  private readonly selectedQuery = computed(() => {
    const id = this.selectedStationId();
    return id ? { q: { ...this.filters.query(), station_id: id }, tick: this.filters.tick() } : undefined;
  });
  readonly overviewRes = rxResource({ params: () => this.selectedQuery(), stream: ({ params }) => this.api.overview(params.q) });
  readonly sensorsRes = rxResource({ params: () => this.selectedQuery(), stream: ({ params }) => this.api.sensorsHealth(params.q) });

  /** Stored packets of the selected buoy since the start of the range (for the in/out chart). */
  readonly historyRes = rxResource({
    params: () => {
      const code = this.selectedCode();
      return code ? { code, since: this.filters.range().from, tick: this.filters.tick() } : undefined;
    },
    stream: ({ params }) => this.telemetry.history(params.code, params.since, HISTORY_LIMIT),
  });

  readonly alerts = keep<AlertSummary>(() => valueOrUndefined(this.alertsRes));
  readonly waste = keep<WasteSummary>(() => valueOrUndefined(this.wasteRes));
  readonly overview = keep<DashboardOverview>(() => valueOrUndefined(this.overviewRes));
  readonly sensors = keep<SensorHealth[]>(() => valueOrUndefined(this.sensorsRes));
  private readonly history = keep<DeviceTelemetryDto[]>(() => valueOrUndefined(this.historyRes));

  /** Packets of the selected buoy that arrived live after the history was loaded. */
  private readonly livePackets = linkedSignal<unknown, DeviceTelemetryDto[]>({ source: () => valueOrUndefined(this.historyRes), computation: () => [] });

  /** `true` when the history hit `HISTORY_LIMIT`, so the chart starts later than the range. */
  readonly historyTruncated = computed(() => (this.history()?.length ?? 0) >= HISTORY_LIMIT);

  /** Packets of the selected buoy inside the range, oldest first, history + live. */
  readonly series = computed<DeviceTelemetryDto[] | undefined>(() => {
    const h = this.history();
    if (!h) return undefined;
    const { from, to } = this.filters.range();
    const openEnded = this.filters.preset() !== 'custom' && this.filters.preset() !== 'yesterday';
    const asc = [...h].reverse();
    const lastTs = asc.length ? Date.parse(asc[asc.length - 1].ts) : 0;
    const all = [...asc, ...this.livePackets().filter((p) => Date.parse(p.ts) > lastTs)];
    return all.filter((p) => {
      const t = Date.parse(p.ts);
      return t >= from.getTime() && (openEnded || t <= to.getTime());
    });
  });

  constructor() {
    effect(() => this.codes().forEach((c) => this.telemetry.ensureLoaded(c)));
    // Append each new packet of the selected buoy to the chart.
    effect(() => {
      const p = this.selected()?.packet;
      if (!p) return;
      untracked(() => this.livePackets.update((l) => (l.some((x) => x.ts === p.ts) ? l : [...l, p].slice(-MAX_LIVE))));
    });
    this.live.reconnected$.pipe(takeUntilDestroyed()).subscribe(() => this.reloadAll());
    this.live.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type !== 'alert' && e.type !== 'waste_collected' && e.type !== 'sensor_status') return;
      if (!this.stationIds().includes(e.data.station_id)) return;
      if (e.type === 'alert') this.alertsRes.reload();
      else if (e.type === 'waste_collected') this.wasteRes.reload();
      else if (e.type === 'sensor_status') this.sensorsRes.reload();
    });
  }

  reloadAll(): void {
    for (const r of [this.alertsRes, this.wasteRes, this.overviewRes, this.sensorsRes, this.historyRes]) r.reload();
  }
}
