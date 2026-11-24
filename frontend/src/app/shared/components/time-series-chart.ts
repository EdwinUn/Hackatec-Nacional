import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';

Chart.register(...registerables);
Chart.defaults.color = '#475569';
Chart.defaults.borderColor = 'rgba(100,116,139,.16)';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
// Merge, don't replace: Chart.js builds every animation from Object.keys(defaults.animation), so a
// bare `{ duration }` object drops `type`/`fn` → "this._fn is not a function" when a color animates.
Chart.defaults.set('animation', { duration: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400 });

/** Chart.js wrapper. Updates the chart in place when the config changes (no flicker on live points). */
@Component({
  selector: 'app-time-series-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `:host { display: block; position: relative; }`,
  template: `<div [style.height]="height()" style="position: relative"><canvas #canvas role="img" [attr.aria-label]="ariaLabel()"></canvas></div>`,
})
export class TimeSeriesChart {
  readonly config = input.required<ChartConfiguration>();
  readonly height = input('320px');
  readonly ariaLabel = input('Gráfica de serie de tiempo');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
    effect(() => {
      const cfg = this.config();
      if (!this.chart) {
        this.chart = new Chart(this.canvas().nativeElement, cfg);
        return;
      }
      this.chart.data = cfg.data;
      this.chart.options = cfg.options ?? {};
      this.chart.update('none');
    });
  }
}
