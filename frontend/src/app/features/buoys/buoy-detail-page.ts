import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { SelectButton } from 'primeng/selectbutton';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { BUOY_STATUS_META } from '../../core/models/buoy.models';
import { deviceCodeFor } from '../../core/models/telemetry.models';
import { TelemetryPanel } from '../../shared/components/telemetry-panel';
import { BuoysService } from '../../core/services/buoys.service';
import { formatCoords } from '../../shared/utils/format.util';
import { BuoyView, BuoyViewer } from './buoy-viewer';

/** Design B specs as listed in the design artifact (prototype values). */
const SPECS: { label: string; value: string }[] = [
  { label: 'Altura', value: '85 cm' },
  { label: 'Diámetro', value: '1.04 m' },
  { label: 'Fijación', value: '3 cadenas con lastre' },
  { label: 'Profundidad de operación', value: '0.8 a 3 m' },
  { label: 'Electrónica', value: 'ESP32 + LoRa 915 MHz' },
  { label: 'Tratamiento', value: '6 filtros + centrífuga' },
];

/**
 * Detail of one buoy: the 3D model is the drawing, and the data goes in a title block
 * (like an engineering drawing) in the corner of the stage.
 */
@Component({
  selector: 'app-buoy-detail-page',
  imports: [DatePipe, FormsModule, RouterLink, Button, SelectButton, ToggleSwitch, BuoyViewer, TelemetryPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .head { display: flex; align-items: center; gap: .5rem; }

    .plate { --water: #10303a; --bar: #0c2830; --paper: #f3f6f5; --ink: #13242e; display: flex; flex-direction: column; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1rem; padding: .6rem .75rem; background: var(--bar); border-radius: 12px 12px 0 0; }
    /* On narrow screens the six views scroll sideways instead of overflowing the page. */
    .views { min-width: 0; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
    .views p-selectbutton { width: max-content; white-space: nowrap; }
    .xray { margin-left: auto; display: flex; align-items: center; gap: .55rem; color: #e2eef0; font-size: .875rem; cursor: pointer; }
    .stage { position: relative; }
    .viewer { height: clamp(440px, 72vh, 780px); border-radius: 0 0 12px 12px; }

    /* Drawing title block: paper and ink, square corners, against the water. */
    .cartouche {
      position: absolute; right: 14px; bottom: 14px; width: min(360px, calc(100% - 28px));
      display: grid; grid-template-columns: 1.5fr 1fr; margin: 0;
      background: var(--paper); color: var(--ink); border: 1.5px solid var(--ink); border-radius: 2px;
      box-shadow: 0 6px 24px rgb(0 0 0 / .35); font-variant-numeric: tabular-nums;
    }
    .cell { padding: .45rem .6rem .5rem; border-bottom: 1px solid var(--ink); }
    .cell:nth-child(odd):not(.full) { border-right: 1px solid var(--ink); }
    .cell.full { grid-column: 1 / -1; border-bottom: 0; }
    .cell dt { font-size: .68rem; color: #4d6470; margin-bottom: .1rem; }
    .cell dd { margin: 0; font-size: .86rem; font-weight: 600; line-height: 1.3; }
    .dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; margin-right: .35rem; vertical-align: .05rem; }

    .specs h2 { font-size: .95rem; font-weight: 650; margin-bottom: .6rem; }
    .specs dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .9rem 0; margin: 0; }
    .specs dl > div { padding: .1rem 1rem; border-left: 1px solid var(--rm-border); }
    .specs dt { font-size: .78rem; color: var(--rm-muted); }
    .specs dd { margin: .15rem 0 0; font-size: 1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .note { font-size: .78rem; margin: .8rem 0 0; max-width: 72ch; }

    @media (max-width: 720px) {
      .viewer { height: 440px; }
      .cartouche { position: static; width: auto; margin-top: .75rem; box-shadow: none; }
      .xray { margin-left: 0; }
    }
  `,
  template: `
    <div class="page">
      @if (buoy(); as b) {
        <header class="head">
          <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" [rounded]="true" ariaLabel="Volver a las boyas" routerLink="/boyas" />
          <div>
            <h1 class="page-title">{{ b.name }}</h1>
            <p class="page-sub">{{ b.river }}</p>
          </div>
        </header>

        <section class="plate" aria-label="Modelo 3D de la boya">
          <div class="toolbar">
            <div class="views">
            <p-selectbutton [options]="views" [ngModel]="view()" (ngModelChange)="view.set($event)" optionLabel="label" optionValue="value" [allowEmpty]="false" size="small" ariaLabel="Vista de cámara" />
            </div>
            <label class="xray">
              <p-toggleswitch [ngModel]="xray()" (ngModelChange)="xray.set($event)" inputId="xray" />
              Rayos X
            </label>
          </div>
          <div class="stage">
            <app-buoy-viewer class="viewer" [design]="b.design" [view]="view()" [xray]="xray()" [ariaLabel]="'Modelo 3D interactivo de ' + b.name + ', boya anclada con tres cadenas'" />
            <dl class="cartouche" aria-label="Datos de la boya">
              <div class="cell"><dt>Código</dt><dd>{{ b.code }}</dd></div>
              <div class="cell">
                <dt>Estado</dt>
                <dd><span class="dot" [style.background]="meta[b.status].color" aria-hidden="true"></span>{{ meta[b.status].label }}</dd>
              </div>
              <div class="cell"><dt>Coordenadas</dt><dd>{{ coords(b.latitude, b.longitude) }}</dd></div>
              <div class="cell"><dt>Instalada</dt><dd>{{ b.installedAt | date: 'dd/MM/yyyy' }}</dd></div>
              <div class="cell full"><dt>Diseño</dt><dd>B, boya con domo anclada con tres cadenas</dd></div>
            </dl>
          </div>
        </section>

        <section id="telemetria" class="rm-card live" aria-labelledby="live-title">
          <h2 id="live-title" class="rm-card-title"><i class="pi pi-wave-pulse" aria-hidden="true"></i> Telemetría en vivo</h2>
          <app-telemetry-panel [code]="deviceCode(b.code)" />
        </section>

        <section class="specs" aria-labelledby="specs-title">
          <h2 id="specs-title">Ficha técnica</h2>
          <dl>
            @for (s of specs; track s.label) {
              <div><dt>{{ s.label }}</dt><dd>{{ s.value }}</dd></div>
            }
          </dl>
          <p class="muted note">Valores de prototipo. El molino y la centrífuga giran con una corriente simulada de 0.9 m/s.</p>
        </section>
      } @else {
        <div class="rm-card empty">
          <i class="pi pi-search" aria-hidden="true"></i>
          <p>No existe una boya con ese identificador.</p>
          <p-button label="Ver todas las boyas" icon="pi pi-arrow-left" routerLink="/boyas" />
        </div>
      }
    </div>
  `,
})
export class BuoyDetailPage {
  private readonly service = inject(BuoysService);
  readonly id = input.required<string>();

  protected readonly buoy = computed(() => this.service.byId(this.id()));
  protected readonly meta = BUOY_STATUS_META;
  protected readonly specs = SPECS;
  protected readonly coords = formatCoords;
  protected readonly deviceCode = deviceCodeFor;

  protected readonly view = signal<BuoyView>('iso');
  protected readonly xray = signal(false);
  protected readonly views: { label: string; value: BuoyView }[] = [
    { label: '3/4', value: 'iso' },
    { label: 'Frente', value: 'front' },
    { label: 'Aguas arriba', value: 'side' },
    { label: 'Bajo el agua', value: 'under' },
    { label: 'Electrónica', value: 'elec' },
    { label: 'Filtros', value: 'filtros' },
  ];
}
