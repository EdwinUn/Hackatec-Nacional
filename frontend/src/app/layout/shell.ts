import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { interval } from 'rxjs';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { DatePicker } from 'primeng/datepicker';
import { Popover } from 'primeng/popover';
import { Select } from 'primeng/select';
import { Toast } from 'primeng/toast';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { AppHeader } from './app-header';
import { BottomNav } from './bottom-nav';
import { APP_CONFIG } from '../core/config/app-config';
import { AuthService } from '../core/auth/auth.service';
import { NativeAlertsService } from '../core/services/native-alerts.service';
import { ROLE_META } from '../shared/utils/ops.util';
import { AlertCounterService } from '../core/services/alert-counter.service';
import { FiltersService, PRESET_LABEL, RangePreset } from '../core/services/filters.service';
import { LiveStreamService } from '../core/services/live-stream.service';
import { StationsService } from '../core/services/stations.service';
import { SEVERITY_META } from '../shared/utils/wqi.util';

const REFRESH_MS = 45_000;

@Component({
  selector: 'app-shell',
  imports: [AppHeader, BottomNav, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, Button, DatePicker, Popover, Select, Toast, ToggleSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly filters = inject(FiltersService);
  protected readonly stationsSvc = inject(StationsService);
  protected readonly live = inject(LiveStreamService);
  protected readonly alertCounter = inject(AlertCounterService);
  protected readonly mock = inject(APP_CONFIG).useMocks;
  private readonly toast = inject(MessageService);
  protected readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly roleMeta = ROLE_META;
  protected readonly initials = computed(() =>
    (this.auth.user()?.name ?? '')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join(''),
  );

  protected readonly collapsed = signal(this.readCollapsed());
  protected readonly mobileOpen = signal(false);
  private readonly url = signal(this.router.url);
  /** Phone: these screens carry their own controls or need none, so the station/period filter bar is hidden there. */
  protected readonly cleanMobile = computed(() => /^\/(inicio|avisos|reportar|resumen|mapa|operaciones|boyas)(\/|$|\?)/.test(this.url()) || this.url() === '/');
  protected readonly onMap = computed(() => this.url().startsWith('/mapa'));
  protected readonly presetLabel = PRESET_LABEL;
  protected readonly presets: Exclude<RangePreset, 'custom'>[] = ['24h', 'yesterday', '7d', '30d'];
  protected readonly draftRange = signal<Date[] | null>(null);
  protected readonly maxDate = new Date();
  protected readonly refreshing = signal(false);

  protected readonly stationOptions = computed(() => [
    { id: null as string | null, name: 'Todas las estaciones' },
    ...this.stationsSvc.stations().map((s) => ({ id: s.id as string | null, name: s.name })),
  ]);

  protected readonly rangeText = computed(() => {
    const { from, to } = this.filters.range();
    const f = (d: Date) => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
    return `${PRESET_LABEL[this.filters.preset()]} · ${f(from)} – ${f(to)}`;
  });

  protected readonly year = new Date().getFullYear();

  constructor() {
    inject(NativeAlertsService).start();

    // Fallback auto-refresh of KPIs.
    interval(REFRESH_MS).pipe(takeUntilDestroyed()).subscribe(() => this.filters.refresh());

    // Live `alert` events raise a floating toast with severity + message.
    this.live.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type !== 'alert') return;
      const sev = e.data.severity;
      this.toast.add({
        key: 'app',
        severity: sev === 'critical' ? 'error' : sev === 'warning' ? 'warn' : 'info',
        summary: `${SEVERITY_META[sev].label} · ${e.data.station_name}`,
        detail: e.data.message,
        life: 8000,
      });
    });

    effect(() => {
      try {
        localStorage.setItem('rm.sidebar', this.collapsed() ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    });
    this.router.events.pipe(takeUntilDestroyed()).subscribe(() => {
      this.mobileOpen.set(false);
      this.url.set(this.router.url);
    });
  }

  protected toggleSidebar(): void {
    if (window.matchMedia('(max-width: 767px), (pointer: coarse) and (max-width: 1400px)').matches) this.mobileOpen.update((v) => !v);
    else this.collapsed.update((v) => !v);
  }

  protected pickPreset(p: Exclude<RangePreset, 'custom'>, pop: Popover): void {
    this.filters.setPreset(p);
    this.draftRange.set(null);
    pop.hide();
  }

  protected onRange(r: Date[] | null, pop: Popover): void {
    this.draftRange.set(r);
    if (r?.[0] && r[1]) {
      this.filters.setCustom(r[0], r[1]);
      pop.hide();
    }
  }

  protected refresh(): void {
    this.filters.refresh();
    this.refreshing.set(true);
    setTimeout(() => this.refreshing.set(false), 700);
  }

  protected focusMain(e: Event): void {
    e.preventDefault();
    document.getElementById('main')?.focus();
  }

  /** Saved preference wins; otherwise start as an icon rail on narrow desktop widths. */
  private readCollapsed(): boolean {
    try {
      const saved = localStorage.getItem('rm.sidebar');
      if (saved !== null) return saved === '1';
    } catch {
      /* storage unavailable */
    }
    return typeof matchMedia === 'function' && matchMedia('(min-width: 768px) and (max-width: 1100px)').matches;
  }
}
