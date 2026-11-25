import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Button } from 'primeng/button';
import { Popover } from 'primeng/popover';
import { Tag } from 'primeng/tag';

/**
 * Where a number comes from (fidelity rule, `docs/fidelidad.md`): only data from a part that exists in
 * the Wokwi circuit, the firmware and the 3D model is «medido».
 */
export type DataOrigin = 'medido' | 'derivado' | 'cuadrilla' | 'simulado' | 'sin-dato';

export const ORIGIN_META: Record<DataOrigin, { label: string; severity: 'info' | 'secondary' | 'warn' | 'contrast'; help: string }> = {
  medido: { label: 'Medido', severity: 'info', help: 'Lo mide una pieza que existe en el circuito de Wokwi, en el firmware y en el modelo 3D. Las boyas son simuladas: no hay boya física.' },
  derivado: { label: 'Derivado', severity: 'secondary', help: 'Se calcula a partir de datos medidos (por el ESP32 o por el backend), con fórmulas y umbrales de prototipo.' },
  cuadrilla: { label: 'Cuadrilla', severity: 'warn', help: 'Lo registra la cuadrilla en campo, por ejemplo los kilos de basura al vaciar la cesta.' },
  simulado: { label: 'Simulado', severity: 'contrast', help: 'Dato de demostración generado por software, no por una pieza de la boya.' },
  'sin-dato': { label: 'Sin dato', severity: 'secondary', help: 'La boya no mandó ese valor (sensor sin respuesta o sin flujo): nunca se muestra como 0.' },
};

/** Small tag that says where a number comes from. */
@Component({
  selector: 'app-origin-tag',
  imports: [Tag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-flex; vertical-align: middle; }
    :host ::ng-deep .p-tag { font-size: .65rem; letter-spacing: .06em; text-transform: uppercase; padding: .1rem .45rem; font-weight: 700; }
  `,
  template: `<p-tag [value]="meta().label" [severity]="meta().severity" [rounded]="true" [attr.title]="meta().help" [attr.aria-label]="'Origen del dato: ' + meta().label" />`,
})
export class OriginTag {
  readonly origin = input.required<DataOrigin>();
  protected readonly meta = computed(() => ORIGIN_META[this.origin()]);
}

/** «¿Qué significan las etiquetas?» button with the legend in a popover (works on touch, unlike a tooltip). */
@Component({
  selector: 'app-origin-legend',
  imports: [Button, Popover, OriginTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .legend { max-width: 22rem; display: flex; flex-direction: column; gap: .7rem; }
    .legend h3 { margin: 0; font-size: .9rem; }
    .legend dl { margin: 0; display: flex; flex-direction: column; gap: .6rem; }
    .legend dt { margin-bottom: .15rem; }
    .legend dd { margin: 0; font-size: .8rem; color: var(--rm-muted); line-height: 1.4; }
  `,
  template: `
    <p-button label="¿De dónde salen los datos?" icon="pi pi-info-circle" [text]="true" size="small" severity="secondary" (onClick)="pop.toggle($event)" ariaLabel="Qué significan las etiquetas de origen de los datos" />
    <p-popover #pop appendTo="body">
      <div class="legend" role="dialog" aria-label="Origen de los datos">
        <h3>Origen de cada dato</h3>
        <dl>
          @for (o of origins; track o) {
            <div><dt><app-origin-tag [origin]="o" /></dt><dd>{{ meta[o].help }}</dd></div>
          }
        </dl>
      </div>
    </p-popover>
  `,
})
export class OriginLegend {
  protected readonly origins: DataOrigin[] = ['medido', 'derivado', 'cuadrilla', 'sin-dato'];
  protected readonly meta = ORIGIN_META;
}
