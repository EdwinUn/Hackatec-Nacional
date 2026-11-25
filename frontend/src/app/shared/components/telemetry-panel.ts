import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { linkQuality } from '../../core/models/telemetry.models';
import { TelemetryService } from '../../core/services/telemetry.service';
import { timeAgo } from '../utils/format.util';

/** Live indicators of a buoy's ESP32 (Wokwi): water quality, basket, current, battery and link. */
@Component({
  selector: 'app-telemetry-panel',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; margin-bottom: .75rem; }
    .badge { display: inline-flex; align-items: center; gap: .45rem; padding: .3rem .75rem; border-radius: 999px; font-size: .75rem; font-weight: 800; letter-spacing: .06em; background: #e2e8f0; color: #475569; }
    .badge .dot { width: .55rem; height: .55rem; border-radius: 50%; background: #94a3b8; }
    .badge.live { background: #d9f4fa; color: #036a83; }
    .badge.live .dot { background: #00b4d8; animation: ping 1.6s infinite; }
    @keyframes ping { 70% { box-shadow: 0 0 0 7px rgb(0 180 216 / 0); } 100% { box-shadow: 0 0 0 0 rgb(0 180 216 / 0); } }
    .when { font-size: .8rem; color: var(--rm-muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .6rem; }
    .cell { display: flex; flex-direction: column; gap: .2rem; padding: .8rem .9rem; background: #fff; border: 1px solid var(--rm-border); border-radius: 16px; min-width: 0; }
    .cell.wide { grid-column: span 2; }
    .lbl { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--rm-muted); font-weight: 600; }
    .val { font-size: 1.6rem; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .val small { font-size: .8rem; font-weight: 500; color: var(--rm-muted); margin-left: .2rem; }
    .sub { font-size: .75rem; color: var(--rm-muted); }
    .meter { height: 7px; border-radius: 999px; background: #eef1f5; overflow: hidden; margin-top: .25rem; }
    .meter span { display: block; height: 100%; border-radius: 999px; transition: width .6s; }
    .cell.alarm { border-color: #f4b4b6; background: #fff5f5; }
    .stale .val { color: var(--rm-muted); }
    .empty { padding: 1.2rem; text-align: center; color: var(--rm-muted); border: 1px dashed var(--rm-border); border-radius: 16px; }
    @media (max-width: 420px) { .cell.wide { grid-column: span 2; } }
  `,
  template: `
    <div class="bar">
      @if (live()) {
        <span class="badge live" role="status"><span class="dot"></span>EN VIVO · ESP32</span>
      } @else {
        <span class="badge" role="status"><span class="dot"></span>{{ p() ? 'SIN SEÑAL · ESP32' : 'ESPERANDO AL ESP32' }}</span>
      }
      @if (p(); as pk) {
        <span class="when">{{ code() }} · último paquete {{ ago(pk.ts) }}@if (pk.seq !== null) { · n.º {{ pk.seq }} }</span>
      } @else {
        <span class="when">{{ code() }} · aún no llega ningún paquete. Inicia la simulación de Wokwi.</span>
      }
    </div>

    @if (p(); as pk) {
      <div class="grid" [class.stale]="!live()">
        <div class="cell"><span class="lbl">pH</span><span class="val">{{ fmt(pk.values?.['ph'], '1.2-2') }}</span><span class="sub">{{ phText(pk.values?.['ph']) }}</span></div>
        <div class="cell"><span class="lbl">Turbidez entrada</span><span class="val">{{ fmt(pk.values?.['turb_in_ntu'], '1.0-1') }}<small>NTU</small></span></div>
        <div class="cell"><span class="lbl">Turbidez salida</span><span class="val">{{ fmt(pk.values?.['turb_out_ntu'], '1.0-1') }}<small>NTU</small></span></div>
        <div class="cell"><span class="lbl">Eficiencia</span><span class="val">{{ fmt(pk.device_efficiency_pct, '1.0-1') }}<small>%</small></span><span class="sub">Calculada por el ESP32</span></div>
        <div class="cell" [class.alarm]="pk.alarm_on"><span class="lbl">Alerta</span><span class="val" [style.color]="pk.alarm_on ? '#b91c1c' : '#0f7a4d'">{{ pk.alarm_on === null ? '—' : pk.alarm_on ? 'ACTIVA' : 'Normal' }}</span>@if (pk.gas_v !== null && pk.gas_v !== undefined) { <span class="sub">Gas {{ fmt(pk.gas_v, '1.2-2') }} V</span> }</div>
        <div class="cell"><span class="lbl">Temperatura</span><span class="val">{{ fmt(pk.values?.['temp_c'], '1.1-1') }}<small>°C</small></span></div>
        @if (has(pk.values?.['do_mgl'])) {
        <div class="cell"><span class="lbl">Oxígeno disuelto</span><span class="val">{{ fmt(pk.values?.['do_mgl'], '1.1-2') }}<small>mg/L</small></span></div>
        }
        @if (has(pk.basket_fill_pct)) {
        <div class="cell">
          <span class="lbl">Nivel de cesta</span>
          <span class="val">{{ fmt(pk.basket_fill_pct, '1.0-0') }}<small>%</small></span>
          <div class="meter" aria-hidden="true"><span [style.width.%]="pct(pk.basket_fill_pct)" [style.background]="basketColor(pk.basket_fill_pct)"></span></div>
          <span class="sub">{{ basketText(pk.basket_fill_pct) }}</span>
        </div>
        }
        @if (has(pk.river_speed_ms)) {
        <div class="cell"><span class="lbl">Corriente</span><span class="val">{{ fmt(pk.river_speed_ms, '1.2-2') }}<small>m/s</small></span><span class="sub">Caudal bomba {{ fmt(pk.flow_rate_lpm, '1.0-1') }} L/min</span></div>
        }
        <div class="cell">
          <span class="lbl">Batería</span>
          <span class="val">{{ fmt(pk.battery_pct, '1.0-0') }}<small>%</small></span>
          <div class="meter" aria-hidden="true"><span [style.width.%]="pct(pk.battery_pct)" [style.background]="batteryColor(pk.battery_pct)"></span></div>
        </div>
        @if (has(pk.rssi_dbm)) {
        <div class="cell">
          <span class="lbl">Enlace</span>
          <span class="val" [style.color]="live() ? link().color : null">{{ live() ? link().label : 'Caído' }}</span>
          <span class="sub">{{ pk.rssi_dbm !== null ? (pk.rssi_dbm | number: '1.0-0') + ' dBm' : '—' }} · bomba {{ pk.pump_on ? 'encendida' : 'apagada' }}</span>
        </div>
        }
      </div>
    } @else {
      <div class="empty"><i class="pi pi-wifi" aria-hidden="true"></i> Esperando datos del ESP32…</div>
    }
  `,
})
export class TelemetryPanel {
  private readonly svc = inject(TelemetryService);
  /** Station code of the buoy (`RM-01`; the 3D model calls it `B-01`). */
  readonly code = input.required<string>();

  protected readonly p = computed(() => this.svc.packet(this.code())());
  protected readonly live = computed(() => this.svc.isLive(this.code())());
  protected readonly link = computed(() => linkQuality(this.p()?.rssi_dbm ?? null));
  protected readonly ago = timeAgo;

  constructor() {
    effect(() => this.svc.ensureLoaded(this.code()));
  }

  protected fmt(v: number | null | undefined, digits: string): string {
    return v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-MX', { minimumFractionDigits: Number(digits.split('.')[1].split('-')[0]), maximumFractionDigits: Number(digits.split('-')[1]) }).format(v);
  }

  protected has(v: number | null | undefined): boolean {
    return v !== null && v !== undefined && Number.isFinite(v);
  }

  protected pct(v: number | null): number {
    return v === null ? 0 : Math.max(0, Math.min(100, v));
  }

  protected phText(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'Sin dato';
    return v < 6.5 ? 'Ácido' : v > 8.5 ? 'Alcalino' : 'Rango aceptable';
  }

  protected basketColor(v: number | null): string {
    return v === null ? '#94a3b8' : v >= 80 ? '#e5484d' : v >= 50 ? '#f59e0b' : '#00b4d8';
  }

  protected basketText(v: number | null): string {
    return v === null ? '' : v >= 80 ? 'Casi llena: vaciar pronto' : v >= 50 ? 'A la mitad' : 'Con espacio';
  }

  protected batteryColor(v: number | null): string {
    return v === null ? '#94a3b8' : v <= 20 ? '#e5484d' : v <= 40 ? '#f59e0b' : '#16a34a';
  }
}
