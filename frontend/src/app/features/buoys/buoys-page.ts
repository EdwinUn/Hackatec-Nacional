import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BUOY_STATUS_META } from '../../core/models/buoy.models';
import { BuoysService } from '../../core/services/buoys.service';
import { MapPoint, MiniMap } from '../../shared/components/mini-map';

/** Overview of the deployed buoys: map + list; each one opens its 3D model. */
@Component({
  selector: 'app-buoys-page',
  imports: [RouterLink, MiniMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 1rem; align-items: start; }
    .map { height: clamp(380px, 66vh, 680px); }

    .panel { background: var(--rm-card); border: 1px solid var(--rm-border); border-radius: 12px; overflow: hidden; }
    .panel h2 { font-size: .9rem; font-weight: 650; padding: .85rem 1rem .7rem; border-bottom: 1px solid var(--rm-border); }
    ul { list-style: none; margin: 0; padding: 0; }
    li + li { border-top: 1px solid var(--rm-border); }
    a { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: .75rem; padding: .8rem 1rem; text-decoration: none; color: inherit; }
    a:hover { background: var(--rm-green-soft); }
    a:focus-visible { outline-offset: -2px; }
    .glyph { width: 40px; height: 40px; }
    .who { display: flex; flex-direction: column; gap: .1rem; min-width: 0; }
    .who strong { font-size: .95rem; }
    .who small { font-size: .78rem; color: var(--rm-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .state { display: flex; align-items: center; gap: .35rem; font-size: .78rem; font-weight: 600; white-space: nowrap; }
    .state i { width: .5rem; height: .5rem; border-radius: 50%; }

    @media (max-width: 980px) { .layout { grid-template-columns: minmax(0, 1fr); } .map { height: 360px; } }
  `,
  template: `
    <div class="page">
      <div>
        <h1 class="page-title">Boyas Río Monitor</h1>
        <p class="page-sub">Toca una boya en el mapa o en la lista para ver su modelo 3D.</p>
      </div>

      <div class="layout">
        <app-mini-map class="map" [points]="points()" (pointClick)="open($event)" />

        <section class="panel" aria-labelledby="buoys-title">
          <h2 id="buoys-title">{{ buoys().length }} boyas instaladas</h2>
          <ul>
            @for (b of buoys(); track b.id) {
              <li>
                <a [routerLink]="['/boyas', b.id]" [attr.aria-label]="b.name + ', ' + b.river + ', ' + meta[b.status].label + ': ver modelo 3D'">
                  <!-- Side view of the buoy: dome, float, cage and three chains; coloured by status. -->
                  <svg class="glyph" viewBox="0 0 40 40" aria-hidden="true" [style.color]="meta[b.status].color">
                    <line x1="20" y1="3" x2="20" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M12 17a8 8 0 0 1 16 0z" fill="currentColor" opacity=".35" stroke="currentColor" stroke-width="1.5" />
                    <rect x="6" y="17" width="28" height="6" rx="3" fill="currentColor" />
                    <rect x="16" y="23" width="8" height="5" fill="none" stroke="currentColor" stroke-width="1.5" />
                    <path d="M16 28 7 37M24 28l9 9M20 28v9" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.6" fill="none" />
                  </svg>
                  <span class="who">
                    <strong>{{ b.name }}</strong>
                    <small>{{ b.river }}</small>
                  </span>
                  <span class="state" [style.color]="meta[b.status].color"><i [style.background]="meta[b.status].color"></i>{{ meta[b.status].label }}</span>
                </a>
              </li>
            }
          </ul>
        </section>
      </div>
    </div>
  `,
})
export class BuoysPage {
  private readonly router = inject(Router);
  protected readonly buoys = inject(BuoysService).buoys;
  protected readonly meta = BUOY_STATUS_META;

  protected readonly points = computed<MapPoint[]>(() =>
    this.buoys().map((b) => ({ id: b.id, latitude: b.latitude, longitude: b.longitude, color: this.meta[b.status].color, label: `${b.name}, ${b.river}` })),
  );

  protected open(id: string): void {
    void this.router.navigate(['/boyas', id]);
  }
}
