import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Sparkline } from './sparkline';

/** Executive KPI card: label, big value, optional badge / delta and a sparkline on the right. */
@Component({
  selector: 'app-kpi-tile',
  imports: [Sparkline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .kpi { height: 100%; display: flex; flex-direction: column; gap: .35rem; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: .5rem; color: var(--rm-muted); font-size: .8rem; font-weight: 600; }
    .top i { color: var(--rm-green); }
    .row { display: flex; align-items: flex-end; justify-content: space-between; gap: .75rem; flex-wrap: nowrap; min-width: 0; }
    .value { font-size: 1.7rem; white-space: nowrap; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; }
    .value small { font-size: .9rem; font-weight: 500; color: var(--rm-muted); margin-left: .2rem; }
    .sub { color: var(--rm-muted); font-size: .8rem; }
    .delta { display: inline-flex; align-items: center; gap: .25rem; font-size: .75rem; font-weight: 700; padding: .1rem .45rem; border-radius: 6px; font-variant-numeric: tabular-nums; i { font-size: .7rem; } }
    .sep { font-size: .9rem; color: var(--rm-muted); margin: 0 .4rem; vertical-align: .1em; }
    .delta.up { color: #0f7a4d; background: #dcf5e8; } .delta.down { color: #b91c1c; background: #fbdcdc; } .delta.flat { color: #475569; background: #e2e8f0; }
  `,
  template: `
    <section class="rm-card kpi" [attr.aria-label]="label()">
      <div class="top">
        <span><i [class]="icon()" aria-hidden="true"></i> {{ label() }}</span>
        @if (deltaView(); as d) {
          <span class="delta" [class]="d.cls" title="vs. periodo anterior"><i [class]="d.icon" aria-hidden="true"></i>{{ d.text }}</span>
        }
      </div>
      <div class="row">
        <div class="value" [style.color]="valueColor()">{{ value() }}@if (valueTo()) {<i class="pi pi-arrow-right sep" aria-label="a"></i>{{ valueTo() }}}@if (unit()) {<small>{{ unit() }}</small>}</div>
        @if (spark().length > 1) {
          <app-sparkline [values]="spark()" [color]="sparkColor()" [ariaLabel]="'Tendencia de ' + label()" />
        }
      </div>
      <ng-content />
      @if (sub()) {
        <div class="sub">{{ sub() }}</div>
      }
    </section>
  `,
})
export class KpiTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly unit = input('');
  /** Second value of an "a → b" pair (rendered with an arrow icon). */
  readonly valueTo = input('');
  readonly icon = input('pi pi-chart-line');
  readonly sub = input('');
  readonly valueColor = input<string | null>(null);
  readonly spark = input<readonly number[]>([]);
  readonly sparkColor = input('#1f7a5a');
  /** Change vs. previous period (percentage or points); `null` hides it. */
  readonly delta = input<number | null>(null);
  readonly deltaSuffix = input('%');
  /** When true a decrease is the good direction (e.g. fewer alerts). */
  readonly lowerIsBetter = input(false);

  protected readonly deltaView = computed(() => {
    const d = this.delta();
    if (d === null || !Number.isFinite(d)) return null;
    const rounded = Math.round(d * 10) / 10;
    const good = this.lowerIsBetter() ? rounded < 0 : rounded > 0;
    const cls = rounded === 0 ? 'flat' : good ? 'up' : 'down';
    const icon = rounded > 0 ? 'pi pi-arrow-up-right' : rounded < 0 ? 'pi pi-arrow-down-right' : 'pi pi-minus';
    return { cls, icon, text: `${Math.abs(rounded)}${this.deltaSuffix()}` };
  });
}
