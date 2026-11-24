import { Injectable, computed, signal } from '@angular/core';
import { Query } from '../models/rio.models';
import { toApiIso } from '../../shared/utils/format.util';

export type RangePreset = '24h' | 'yesterday' | '7d' | '30d' | 'custom';

export const PRESET_LABEL: Record<RangePreset, string> = {
  '24h': 'Últimas 24 h',
  yesterday: 'Ayer',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  custom: 'Rango personalizado',
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface DateRange {
  from: Date;
  to: Date;
}

export function rangeFor(preset: RangePreset, now: number, custom: DateRange | null): DateRange {
  switch (preset) {
    case 'yesterday': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: new Date(start.getTime() - DAY), to: start };
    }
    case '7d':
      return { from: new Date(now - 7 * DAY), to: new Date(now) };
    case '30d':
      return { from: new Date(now - 30 * DAY), to: new Date(now) };
    case 'custom':
      if (custom) return custom;
      return { from: new Date(now - DAY), to: new Date(now) };
    default:
      return { from: new Date(now - DAY), to: new Date(now) };
  }
}

/** Global header filters shared by every view: station, date range, period comparison, refresh. */
@Injectable({ providedIn: 'root' })
export class FiltersService {
  /** `null` = "Todas las estaciones". */
  readonly stationId = signal<string | null>(null);
  readonly preset = signal<RangePreset>('24h');
  readonly custom = signal<DateRange | null>(null);
  readonly compare = signal(false);
  /** Bumped by manual / automatic refresh so every view re-queries. */
  readonly tick = signal(0);
  private readonly now = signal(Date.now());

  readonly range = computed(() => rangeFor(this.preset(), this.now(), this.custom()));
  /** Same-length window right before `range`, for period comparison. */
  readonly previousRange = computed<DateRange>(() => {
    const { from, to } = this.range();
    const len = to.getTime() - from.getTime();
    return { from: new Date(from.getTime() - len), to: new Date(from.getTime()) };
  });

  readonly query = computed<Query>(() => this.toQuery(this.range()));
  readonly previousQuery = computed<Query>(() => this.toQuery(this.previousRange()));

  setStation(id: string | null): void {
    this.stationId.set(id);
  }

  setPreset(p: Exclude<RangePreset, 'custom'>): void {
    this.preset.set(p);
    this.now.set(Date.now());
  }

  /** Custom range: whole days, the end capped at "now". */
  setCustom(from: Date, to: Date): void {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 0);
    this.custom.set({ from: start, to: new Date(Math.min(end.getTime(), Date.now())) });
    this.preset.set('custom');
  }

  refresh(): void {
    this.now.set(Date.now());
    this.tick.update((n) => n + 1);
  }

  private toQuery(r: DateRange): Query {
    const id = this.stationId();
    return { ...(id ? { station_id: id } : {}), from: toApiIso(r.from), to: toApiIso(r.to) };
  }
}
