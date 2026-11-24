import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-flex; }
    .pill { display: inline-flex; align-items: center; gap: .35rem; padding: .15rem .55rem; border-radius: 999px; font-size: .75rem; font-weight: 600; white-space: nowrap; }
    .dot { width: .45rem; height: .45rem; border-radius: 50%; }
  `,
  template: `<span class="pill" [style.color]="color()" [style.background]="bg()"><span class="dot" [style.background]="color()"></span>{{ label() }}</span>`,
})
export class Pill {
  readonly label = input.required<string>();
  readonly color = input('#475569');
  readonly bg = input('#e2e8f0');
}
