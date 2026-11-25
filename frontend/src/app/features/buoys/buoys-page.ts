import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BUOY_SATURATED_AT, BUOY_STATE_META, Buoy, BuoyState, buoyState } from '../../core/models/buoy.models';
import { TelemetryPacket, deviceCodeFor } from '../../core/models/telemetry.models';
import { AuthService } from '../../core/auth/auth.service';
import { LayoutService } from '../../core/services/layout.service';
import { SkimmerSurvey } from '../operator/skimmer-survey';
import { BuoysService } from '../../core/services/buoys.service';
import { TelemetryService } from '../../core/services/telemetry.service';
import { MapPoint, MiniMap } from '../../shared/components/mini-map';
import { formatCoords } from '../../shared/utils/format.util';

type Mode = 'map' | 'list';

/** Skimmer buoys: switch between the map and a list of cards; each one opens its telemetry or 3D model. */
@Component({
  selector: 'app-buoys-page',
  imports: [RouterLink, MiniMap, SkimmerSurvey],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; max-width: 100%; overflow-x: hidden; }
    .seg { display: inline-grid; grid-template-columns: 1fr 1fr; padding: 4px; border-radius: 999px; background: #eaecf0; width: min(320px, 100%); }
    .seg button { display: inline-flex; align-items: center; justify-content: center; gap: .4rem; padding: .55rem 1rem; border: 0; border-radius: 999px; background: transparent; color: #1b263b; font: inherit; font-size: .88rem; font-weight: 700; cursor: pointer; transition: background .2s, color .2s; }
    .seg button.on { background: #00b4d8; color: #0d1b2a; box-shadow: 0 2px 8px rgb(0 180 216 / .35); }
    .seg button:not(.on):hover { background: #dfe3ea; }
    .seg button:focus-visible { outline: 2px solid #1b263b; outline-offset: 2px; }

    .map { height: clamp(340px, 58vh, 640px); border-radius: 18px; }
    .legend { display: flex; flex-wrap: wrap; gap: .4rem .9rem; font-size: .78rem; color: var(--rm-muted); }
    .legend span { display: inline-flex; align-items: center; gap: .35rem; }
    .legend i { width: .6rem; height: .6rem; border-radius: 50%; }
    .mapbox { position: relative; }
    .strip { position: absolute; left: .5rem; right: .5rem; bottom: .5rem; z-index: 5; display: flex; gap: .4rem; overflow-x: auto; padding: .4rem; border-radius: 16px; background: rgb(255 255 255 / .94); box-shadow: 0 4px 16px rgb(0 0 0 / .25); scrollbar-width: none; }
    .strip button { flex: 0 0 auto; display: inline-flex; align-items: center; gap: .45rem; padding: .4rem .7rem; border: 1px solid #eaecf0; border-radius: 12px; background: #fff; color: #1b263b; font: inherit; font-size: .78rem; cursor: pointer; text-align: left; }
    .strip button.on { border-color: #00b4d8; background: #e6f8fc; }
    .strip i { width: .7rem; height: .7rem; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #cbd5e1; flex: none; }
    .strip b { display: block; font-size: .78rem; line-height: 1.1; }
    .strip small { color: var(--rm-muted); font-size: .7rem; }
    .scrim { position: fixed; inset: 0; z-index: 790; background: rgb(13 27 42 / .35); opacity: 0; pointer-events: none; transition: opacity .32s; }
    .scrim.open { opacity: 1; pointer-events: auto; }
    .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 800; max-width: 640px; margin: 0 auto; max-height: 82dvh; overflow-y: auto; padding: 10px 18px calc(20px + env(safe-area-inset-bottom)); background: #fff; border-radius: 24px 24px 0 0; box-shadow: 0 -8px 28px rgb(13 27 42 / .22); transform: translateY(105%); visibility: hidden; transition: transform .32s cubic-bezier(.22, 1, .36, 1), visibility 0s .32s; display: flex; flex-direction: column; gap: .75rem; }
    .sheet.open { transform: translateY(0); visibility: visible; transition: transform .32s cubic-bezier(.22, 1, .36, 1); }
    .handle { align-self: center; width: 44px; height: 5px; border-radius: 999px; background: #d0d5dd; }
    .sheet .x { margin-left: auto; display: inline-flex; align-items: center; gap: .35rem; padding: .35rem .75rem; border: 1px solid #eaecf0; border-radius: 999px; background: #fff; color: #1b263b; font: inherit; font-size: .82rem; font-weight: 650; cursor: pointer; }
    .sheet .x:focus-visible { outline: 2px solid #1b263b; outline-offset: 2px; }
    .sheet h2 { font-size: 1.2rem; font-weight: 800; }
    .last { margin: 0; font-size: .78rem; color: var(--rm-muted); }
    .btn.big { padding: .85rem 1rem; border-radius: 14px; font-size: 1rem; flex-basis: 100%; }
    .btn.tele { border: 1px solid #1b263b; color: #1b263b; background: #fff; }
    button.btn { cursor: pointer; border: 1px solid #00b4d8; background: #e6f8fc; color: #036a83; }
    @media (prefers-reduced-motion: reduce) { .sheet, .scrim { transition: none; } }

    .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: .75rem; }
    .card { display: flex; flex-direction: column; gap: .65rem; min-width: 0; padding: 1rem; background: #fff; border: 1px solid #eaecf0; border-radius: 18px; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; }
    .top h2 { font-size: 1.05rem; font-weight: 800; }
    .code { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--rm-muted); font-weight: 700; }
    .where { margin: 0; font-size: .8rem; color: var(--rm-muted); overflow-wrap: anywhere; }
    .badges { display: flex; flex-wrap: wrap; gap: .35rem; }
    .badge { display: inline-flex; align-items: center; gap: .4rem; padding: .2rem .65rem; border-radius: 999px; font-size: .72rem; font-weight: 800; letter-spacing: .04em; background: #e2e8f0; color: #475569; white-space: nowrap; }
    .badge i { width: .5rem; height: .5rem; border-radius: 50%; background: #94a3b8; }
    .badge.live { background: #d9f4fa; color: #036a83; }
    .badge.live i { background: #00b4d8; animation: ping 1.6s infinite; }
    @keyframes ping { 70% { box-shadow: 0 0 0 6px rgb(0 180 216 / 0); } 100% { box-shadow: 0 0 0 0 rgb(0 180 216 / 0); } }
    .meters { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .meter .lbl { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--rm-muted); font-weight: 600; }
    .meter .lbl b { color: #1b263b; font-size: .85rem; letter-spacing: 0; }
    .track { height: 7px; margin-top: .3rem; border-radius: 999px; background: #eef1f5; overflow: hidden; }
    .track span { display: block; height: 100%; border-radius: 999px; transition: width .6s; }
    .actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .btn { flex: 1 1 130px; display: inline-flex; align-items: center; justify-content: center; gap: .45rem; padding: .6rem .9rem; border-radius: 12px; font: inherit; font-size: .85rem; font-weight: 700; text-decoration: none; white-space: nowrap; }
    .btn.ghost { border: 1px solid #1b263b; color: #1b263b; background: #fff; }
    .btn.solid { background: linear-gradient(135deg, #0077b6, #00b4d8); color: #fff; box-shadow: 0 4px 12px rgb(0 180 216 / .3); }
    .btn:focus-visible { outline: 2px solid #1b263b; outline-offset: 2px; }
  `,
  template: `
    <div class="page">
      <div>
        <h1 class="page-title">Boyas</h1>
        <p class="page-sub">Consulta dónde están y cómo van; abre su telemetría o su modelo 3D.</p>
      </div>

      <div class="seg" role="tablist" aria-label="Forma de ver las boyas">
        <button type="button" role="tab" [class.on]="mode() === 'map'" [attr.aria-selected]="mode() === 'map'" (click)="mode.set('map')"><i class="pi pi-map" aria-hidden="true"></i>En Mapa</button>
        <button type="button" role="tab" [class.on]="mode() === 'list'" [attr.aria-selected]="mode() === 'list'" (click)="mode.set('list')"><i class="pi pi-list" aria-hidden="true"></i>En Lista</button>
      </div>

      @if (mode() === 'map') {
        <div class="mapbox">
          <app-mini-map class="map" [points]="points()" [selectedId]="selectedId()" (pointClick)="selectedId.set($event)" />
          <div class="strip" role="group" aria-label="Boyas en el mapa">
            @for (b of buoys(); track b.id) {
              <button type="button" [class.on]="selectedId() === b.id" [attr.aria-pressed]="selectedId() === b.id" (click)="selectedId.set(b.id)">
                <i [style.background]="shown(b).color"></i>
                <span><b>{{ b.code }}</b><small>{{ b.name }}</small></span>
              </button>
            }
          </div>
        </div>
        <div class="legend" aria-label="Leyenda de estados">
          @for (s of legend; track s.label) { <span><i [style.background]="s.color"></i>{{ s.label }}</span> }
        </div>
        <div class="scrim" [class.open]="!!selected()" (click)="selectedId.set(null)"></div>
        <section class="sheet" [class.open]="!!selected()" [attr.aria-hidden]="!selected()" role="dialog" aria-label="Detalle de la boya">
          <span class="handle" aria-hidden="true"></span>
          @if (shownSel(); as b) {
            <button type="button" class="x" (click)="selectedId.set(null)"><i class="pi pi-times" aria-hidden="true"></i>Ver todas</button>
            <div class="top">
              <div><span class="code">{{ b.code }}</span><h2>{{ b.name }}</h2></div>
              <span class="badge" [style.background]="shown(b).bg" [style.color]="shown(b).color">{{ shown(b).label }}</span>
            </div>
            <p class="where"><i class="pi pi-map-marker" aria-hidden="true"></i> {{ b.river }} · {{ coords(b.latitude, b.longitude) }}</p>
            <div class="meters">
              <div class="meter">
                <div class="lbl">Cesta <b>{{ pctText(packet(b)?.basket_fill_pct) }}</b></div>
                <div class="track" aria-hidden="true"><span [style.width.%]="pct(packet(b)?.basket_fill_pct)" [style.background]="basketColor(packet(b)?.basket_fill_pct)"></span></div>
              </div>
              <div class="meter">
                <div class="lbl">Batería <b>{{ pctText(packet(b)?.battery_pct) }}</b></div>
                <div class="track" aria-hidden="true"><span [style.width.%]="pct(packet(b)?.battery_pct)" [style.background]="batteryColor(packet(b)?.battery_pct)"></span></div>
              </div>
            </div>
            <p class="last"><i class="pi pi-clock" aria-hidden="true"></i> Última lectura: {{ lastReading(b) }}</p>
            <div class="actions">
              <a class="btn big solid" [routerLink]="['/boyas', b.id]"><i class="pi pi-box" aria-hidden="true"></i>Abrir Modelo 3D</a>
              @if (auth.isLoggedIn()) { <button type="button" class="btn" (click)="surveyOpen.set(true)"><i class="pi pi-inbox" aria-hidden="true"></i>Registrar vaciado</button> }
            </div>
          }
        </section>
        <app-skimmer-survey [(visible)]="surveyOpen" [stationId]="null" />
      } @else {
        <div class="list">
          @for (b of buoys(); track b.id) {
            <article class="card" [attr.aria-label]="b.name">
              <div class="top">
                <div><span class="code">{{ b.code }}</span><h2>{{ b.name }}</h2></div>
                <span class="badge" [style.background]="shown(b).bg" [style.color]="shown(b).color">{{ shown(b).label }}</span>
              </div>
              <p class="where"><i class="pi pi-map-marker" aria-hidden="true"></i> {{ b.river }} · {{ coords(b.latitude, b.longitude) }}</p>
              <div class="meters">
                <div class="meter">
                  <div class="lbl">Cesta <b>{{ pctText(packet(b)?.basket_fill_pct) }}</b></div>
                  <div class="track" aria-hidden="true"><span [style.width.%]="pct(packet(b)?.basket_fill_pct)" [style.background]="basketColor(packet(b)?.basket_fill_pct)"></span></div>
                </div>
                <div class="meter">
                  <div class="lbl">Batería <b>{{ pctText(packet(b)?.battery_pct) }}</b></div>
                  <div class="track" aria-hidden="true"><span [style.width.%]="pct(packet(b)?.battery_pct)" [style.background]="batteryColor(packet(b)?.battery_pct)"></span></div>
                </div>
              </div>
              <div class="actions">
                <a class="btn ghost" [routerLink]="['/boyas', b.id]" fragment="telemetria"><i class="pi pi-wave-pulse" aria-hidden="true"></i>Ver Telemetría</a>
                <a class="btn solid" [routerLink]="['/boyas', b.id]"><i class="pi pi-box" aria-hidden="true"></i>Modelo 3D</a>
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
})
export class BuoysPage {
  private readonly telemetry = inject(TelemetryService);
  protected readonly buoys = inject(BuoysService).buoys;
  protected readonly coords = formatCoords;
  protected readonly legend = (['live', 'saturated', 'stale', 'nodata'] as BuoyState[]).map((s) => BUOY_STATE_META[s]);

  protected readonly auth = inject(AuthService);
  private readonly layout = inject(LayoutService);
  protected readonly surveyOpen = signal(false);
  protected readonly mode = signal<Mode>('map');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.buoys().find((b) => b.id === this.selectedId()) ?? null);

  protected readonly points = computed<MapPoint[]>(() =>
    this.buoys().map((b) => ({ id: b.id, latitude: b.latitude, longitude: b.longitude, color: this.shown(b).color, label: `${b.name} · ${this.shown(b).label}` })),
  );

  /** Keeps the last selected buoy rendered while the sheet slides out. */
  private last: Buoy | null = null;
  protected shownSel(): Buoy | null {
    const b = this.selected();
    if (b) this.last = b;
    return b ?? this.last;
  }

  constructor() {
    effect(() => this.layout.navHidden.set(this.mode() === 'map' && !!this.selected()));
    inject(DestroyRef).onDestroy(() => this.layout.navHidden.set(false));
    effect(() => this.buoys().forEach((b) => this.telemetry.ensureLoaded(deviceCodeFor(b.code))));
  }

  protected packet(b: Buoy): TelemetryPacket | null {
    return this.telemetry.packet(deviceCodeFor(b.code))();
  }

  protected isLive(b: Buoy): boolean {
    return this.telemetry.isLive(deviceCodeFor(b.code))();
  }

  /** State from the telemetry (the buoys only exist in Wokwi): live, saturated, no signal or no data. */
  protected shown(b: Buoy): { label: string; color: string; bg: string } {
    return BUOY_STATE_META[buoyState(this.packet(b), this.isLive(b))];
  }

  protected lastReading(b: Buoy): string {
    const ts = this.packet(b)?.ts;
    if (!ts) return 'sin lecturas todavía';
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? 'sin lecturas todavía' : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  protected pct(v: number | null | undefined): number {
    return v == null ? 0 : Math.max(0, Math.min(100, v));
  }

  protected pctText(v: number | null | undefined): string {
    return v == null ? '—' : `${Math.round(v)} %`;
  }

  protected basketColor(v: number | null | undefined): string {
    return v == null ? '#cbd5e1' : v >= BUOY_SATURATED_AT ? '#e5484d' : v >= 50 ? '#f59e0b' : '#00b4d8';
  }

  protected batteryColor(v: number | null | undefined): string {
    return v == null ? '#cbd5e1' : v <= 20 ? '#e5484d' : v <= 40 ? '#f59e0b' : '#16a34a';
  }
}
