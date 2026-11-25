import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { HealthZone, School } from '../../core/models/health-zones.models';
import { Hotspot } from '../../core/models/rio.models';
import { HealthZonesService } from '../../core/services/health-zones.service';
import { Pill } from '../../shared/components/pill';
import { distanceToPolylinesM, formatApproxDistance } from '../../shared/utils/geo.util';
import { EVIDENCE_META, EXPOSURE_META } from '../../shared/utils/health-zones.util';
import { distanceKm, formatDistance } from '../../shared/utils/ops.util';
import { CRITICALITY_META, WQI_META, wqiText } from '../../shared/utils/wqi.util';
import { RIVERS } from './basin';

export type HealthDetail = { kind: 'zone'; zone: HealthZone } | { kind: 'school'; school: School };

const RIVER_PATHS = RIVERS.map((r) => r.path);
/** Schools listed before «Ver todas». */
const SCHOOLS_PREVIEW = 6;

/**
 * Body of the map's side drawer for a health-impact zone or a school inside one
 * (the drawer header, with the title and the close button, stays in the satellite page).
 */
@Component({
  selector: 'app-health-zone-panel',
  imports: [Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: .7rem; font-size: .85rem; color: #d7e6df; }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
    p { margin: 0; overflow-wrap: anywhere; }
    h3 { margin: .2rem 0 0; font-size: .7rem; letter-spacing: .06em; text-transform: uppercase; color: #9fc2b3; }
    ul { margin: 0; padding-left: 1rem; display: grid; gap: .2rem; }
    .chips { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: .35rem; }
    .chip { display: inline-flex; align-items: center; gap: .35rem; padding: .2rem .55rem; border-radius: 999px; background: rgb(255 255 255 / .1); font-size: .75rem; }
    .kv { margin: 0; display: grid; gap: .4rem; }
    .kv div { display: flex; flex-direction: column; padding: .45rem .7rem; border-radius: 10px; background: rgb(255 255 255 / .08); }
    .kv dt { font-size: .66rem; letter-spacing: .06em; text-transform: uppercase; color: #9fc2b3; }
    .kv dd { margin: 0; overflow-wrap: anywhere; }
    .list { list-style: none; padding: 0; gap: .3rem; }
    .item { width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: .1rem; text-align: left; padding: .45rem .65rem; border: 0; border-radius: 10px;
      background: rgb(255 255 255 / .06); color: inherit; font: inherit; cursor: pointer;
      &:hover, &:focus-visible { background: rgb(255 255 255 / .14); }
      small { color: #b6d0c4; font-size: .72rem; } }
    .more { align-self: flex-start; border: 0; background: none; color: #7dd3fc; font: inherit; font-size: .78rem; cursor: pointer; padding: 0; }
    .station { border-left: 4px solid; }
    .warn { padding: .55rem .7rem; border-radius: 10px; background: rgb(250 204 21 / .12); color: #fde68a; font-size: .75rem; display: flex; gap: .45rem; }
    .src { color: #b6d0c4; font-size: .72rem; }
    a { color: #7dd3fc; overflow-wrap: anywhere; }
  `,
  template: `
    @switch (detail().kind) {
      @case ('zone') {
        @let z = zone()!;
        <div class="row">
          <app-pill [label]="levelMeta[z.nivel].label" [color]="levelMeta[z.nivel].color" [bg]="levelMeta[z.nivel].bg" />
          <span class="chip" [title]="evidenceMeta[z.evidencia].hint"><i class="pi pi-book" aria-hidden="true"></i> {{ evidenceMeta[z.evidencia].label }}</span>
          <span class="src">{{ z.municipios.join(', ') }} ({{ z.estado }})</span>
        </div>
        <p>{{ z.descripcion }}</p>

        <h3>Exposición</h3>
        <ul class="chips">
          @for (e of z.exposiciones; track e) {
            <li class="chip"><i [class]="exposureMeta[e].icon" aria-hidden="true"></i> {{ exposureMeta[e].label }}</li>
          }
        </ul>

        <h3>Efectos en la salud reportados</h3>
        <ul>
          @for (x of z.efectos_salud; track x) { <li>{{ x }}</li> }
        </ul>

        <h3>Comunidades</h3>
        <p>{{ z.comunidades.join(' · ') }}</p>

        @if (nearestStation(); as st) {
          <h3>Monitoreo más cercano</h3>
          <button type="button" class="item station" [style.border-left-color]="wqiMeta[st.h.wqi.category].color" (click)="selectStation.emit(st.h.station_id)">
            <span>{{ st.h.name }}</span>
            <small>{{ wqiMeta[st.h.wqi.category].label }} · WQI {{ wqiText(st.h.wqi) }} · a {{ st.km }} del centro de la zona</small>
          </button>
        }

        <h3><i class="pi pi-graduation-cap" aria-hidden="true"></i> Escuelas en la zona · {{ zoneSchools().length }}</h3>
        @if (zoneSchools().length) {
          <ul class="list">
            @for (s of visibleSchools(); track s.id) {
              <li>
                <button type="button" class="item" (click)="openSchool.emit(s)">
                  <span>{{ s.nombre }}</span>
                  <small>{{ s.nivel }} · {{ s.sostenimiento }} · {{ s.localidad }}</small>
                </button>
              </li>
            }
          </ul>
          @if (zoneSchools().length > preview) {
            <button type="button" class="more" (click)="showAll.set(!showAll())">{{ showAll() ? 'Ver menos' : 'Ver las ' + zoneSchools().length + ' escuelas' }}</button>
          }
        } @else {
          <p class="src">Sin escuelas registradas en el DENUE dentro de la zona.</p>
        }

        <h3>Fuentes</h3>
        <ul>
          @for (f of z.fuentes; track f.url) {
            <li><a [href]="f.url" target="_blank" rel="noopener">{{ f.titulo }}</a></li>
          }
        </ul>
        <p class="warn"><i class="pi pi-info-circle" aria-hidden="true"></i>
          Afectaciones reportadas en estudios y notas públicas; no son mediciones de Río Monitor. El contorno de la zona es aproximado.</p>
      }
      @case ('school') {
        @let s = school()!;
        <div class="row">
          <span class="chip"><i class="pi pi-graduation-cap" aria-hidden="true"></i> {{ s.nivel }}</span>
          <span class="chip">{{ s.sostenimiento }}</span>
        </div>
        <dl class="kv">
          <div><dt>Localidad</dt><dd>{{ s.localidad }}, {{ s.municipio }}</dd></div>
          <div><dt>Distancia al cauce</dt><dd>{{ riverDistance() }} <span class="src">(trazo aproximado del río)</span></dd></div>
        </dl>
        @if (schoolZone(); as z) {
          <h3>Zona de afectación</h3>
          <button type="button" class="item" (click)="openZone.emit(z)">
            <span>{{ z.nombre }}</span>
            <small>{{ levelMeta[z.nivel].label }} · {{ evidenceMeta[z.evidencia].label }}</small>
          </button>
          <h3>A qué está expuesta</h3>
          <ul class="chips">
            @for (e of z.exposiciones; track e) {
              <li class="chip"><i [class]="exposureMeta[e].icon" aria-hidden="true"></i> {{ exposureMeta[e].label }}</li>
            }
          </ul>
          <h3>Efectos en la salud reportados en la zona</h3>
          <ul>
            @for (x of z.efectos_salud; track x) { <li>{{ x }}</li> }
          </ul>
        }
        <p class="src">Fuente: INEGI, DENUE 05/2026 (SCIAN 6111). La escuela no tiene mediciones propias: hereda los riesgos documentados de su zona.</p>
      }
    }
  `,
})
export class HealthZonePanel {
  private readonly health = inject(HealthZonesService);

  readonly detail = input.required<HealthDetail>();
  /** Monitoring stations (to point at the closest one). */
  readonly stations = input<Hotspot[]>([]);
  readonly openSchool = output<School>();
  readonly openZone = output<HealthZone>();
  readonly selectStation = output<string>();

  protected readonly levelMeta = CRITICALITY_META;
  protected readonly evidenceMeta = EVIDENCE_META;
  protected readonly exposureMeta = EXPOSURE_META;
  protected readonly wqiMeta = WQI_META;
  protected readonly wqiText = wqiText;
  protected readonly preview = SCHOOLS_PREVIEW;
  /** Collapses again when another zone is opened. */
  protected readonly showAll = linkedSignal({ source: () => this.zone()?.id, computation: () => false });

  protected readonly zone = computed(() => {
    const d = this.detail();
    return d.kind === 'zone' ? d.zone : null;
  });
  protected readonly school = computed(() => {
    const d = this.detail();
    return d.kind === 'school' ? d.school : null;
  });

  protected readonly zoneSchools = computed(() => {
    const z = this.zone();
    return z ? this.health.schoolsIn(z.id) : [];
  });
  protected readonly visibleSchools = computed(() => (this.showAll() ? this.zoneSchools() : this.zoneSchools().slice(0, SCHOOLS_PREVIEW)));

  protected readonly nearestStation = computed(() => {
    const c = this.zone()?.center;
    if (!c) return null;
    const here = { latitude: c[1], longitude: c[0] };
    let best: { h: Hotspot; d: number } | null = null;
    for (const h of this.stations()) {
      const d = distanceKm(here, h);
      if (!best || d < best.d) best = { h, d };
    }
    return best ? { h: best.h, km: formatDistance(best.d) } : null;
  });

  protected readonly schoolZone = computed(() => {
    const s = this.school();
    return s ? (this.health.zone(s.zona_id) ?? null) : null;
  });
  protected readonly riverDistance = computed(() => {
    const s = this.school();
    return s ? formatApproxDistance(distanceToPolylinesM([s.coordinates[1], s.coordinates[0]], RIVER_PATHS)) : '—';
  });
}
