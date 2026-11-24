import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Tiny dependency-free SVG sparkline (line + soft area). */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `:host { display: inline-block; line-height: 0; } svg { overflow: visible; }`,
  template: `
    @if (geo(); as g) {
      <svg [attr.width]="width()" [attr.height]="height()" [attr.viewBox]="'0 0 ' + width() + ' ' + height()" role="img" [attr.aria-label]="ariaLabel()">
        <path [attr.d]="g.area" [attr.fill]="color()" fill-opacity="0.12" />
        <path [attr.d]="g.line" fill="none" [attr.stroke]="color()" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle [attr.cx]="g.lastX" [attr.cy]="g.lastY" r="2.8" [attr.fill]="color()" />
      </svg>
    }
  `,
})
export class Sparkline {
  readonly values = input<readonly number[]>([]);
  readonly color = input('#1f7a5a');
  readonly width = input(96);
  readonly height = input(34);
  readonly ariaLabel = input('Tendencia');

  protected readonly geo = computed(() => {
    const v = this.values();
    if (v.length < 2) return null;
    const w = this.width();
    const h = this.height();
    const pad = 3;
    const min = Math.min(...v);
    const max = Math.max(...v);
    const span = max - min || 1;
    const pts = v.map((y, i) => [(i / (v.length - 1)) * w, pad + (1 - (y - min) / span) * (h - pad * 2)] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return { line, area: `${line} L${w},${h} L0,${h} Z`, lastX: last[0], lastY: last[1] };
  });
}
