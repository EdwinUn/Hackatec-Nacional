import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { SelectButton } from 'primeng/selectbutton';
import { VisionAnalysis } from '../../core/models/vision.models';
import { BUOY_STATUS_LABEL, VISION_CATEGORY_META, VISION_SEVERITY_META } from '../utils/vision.util';
import { Pill } from './pill';

/**
 * AI result of a citizen's photo: category, severity, reasons, detections and the annotated picture.
 * Used while reporting (with a loading / error state) and when consulting a report.
 */
@Component({
  selector: 'app-ai-analysis',
  imports: [DecimalPipe, FormsModule, Button, SelectButton, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .ai { display: flex; flex-direction: column; gap: .75rem; }
    .head { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
    .head h3 { font-size: .95rem; margin: 0; font-weight: 650; display: flex; align-items: center; gap: .45rem; }
    .head h3 i { color: var(--rm-green); }
    .head .spacer { margin-left: auto; }
    .cat { display: flex; align-items: center; gap: .6rem; font-weight: 650; font-size: 1.05rem; }
    .cat i { font-size: 1.3rem; }
    .summary { margin: 0; }
    .reasons { margin: 0; padding-left: 1.1rem; display: grid; gap: .25rem; font-size: .88rem; }
    .view { position: relative; }
    .view img { width: 100%; max-height: 360px; object-fit: contain; border-radius: 10px; background: #0b1d16; display: block; }
    .toggle { margin-bottom: .5rem; }
    .chips { display: flex; flex-wrap: wrap; gap: .35rem; }
    .chip { display: inline-flex; align-items: center; gap: .4rem; padding: .2rem .55rem; border-radius: 999px; background: var(--rm-canvas); border: 1px solid var(--rm-border); font-size: .8rem; }
    .chip strong { font-variant-numeric: tabular-nums; }
    .meta { font-size: .78rem; color: var(--rm-muted); display: flex; flex-wrap: wrap; gap: .2rem .9rem; }
    .note { margin: 0; font-size: .76rem; color: var(--rm-muted); display: flex; gap: .4rem; align-items: flex-start; }
    .loading { display: flex; align-items: center; gap: .7rem; color: var(--rm-muted); }
    .loading i { color: var(--rm-green); font-size: 1.4rem; }
    .err { display: flex; flex-direction: column; align-items: flex-start; gap: .5rem; }
    .err p { margin: 0; }
  `,
  template: `
    <section class="ai" aria-live="polite" aria-label="Análisis de la foto con inteligencia artificial">
      <div class="head">
        <h3><i class="pi pi-sparkles" aria-hidden="true"></i> Análisis con IA</h3>
        @if (analysis(); as a) {
          <span class="spacer"><app-pill [label]="'Severidad ' + sev()[a.severity].label.toLowerCase()" [color]="sev()[a.severity].color" [bg]="sev()[a.severity].bg" /></span>
        }
      </div>

      @if (loading()) {
        <div class="loading"><i class="pi pi-spin pi-spinner" aria-hidden="true"></i><span>Analizando la foto… puede tardar unos segundos.</span></div>
      } @else if (error()) {
        <div class="err">
          <p><i class="pi pi-info-circle" aria-hidden="true"></i> {{ error() }} <span class="muted">Puedes enviar tu reporte de todos modos.</span></p>
          <p-button label="Reintentar análisis" icon="pi pi-refresh" size="small" [outlined]="true" (onClick)="retry.emit()" />
        </div>
      } @else if (analysis(); as a) {
        <div class="cat"><i [class]="cat()[a.category].icon" [style.color]="a.category === 'normal' ? '#0f7a4d' : sev()[a.severity].color" aria-hidden="true"></i>{{ cat()[a.category].label }}</div>
        <p class="summary">{{ a.summary }}</p>
        @if (a.reasons.length) {
          <ul class="reasons">@for (r of a.reasons; track r) { <li>{{ r }}</li> }</ul>
        }

        <div class="view">
          @if (original()) {
            <p-selectbutton class="toggle" [options]="views" [(ngModel)]="view" optionLabel="label" optionValue="value" size="small" [allowEmpty]="false" ariaLabel="Imagen" />
          }
          <img [src]="shown()" [alt]="view() === 'annotated' ? 'Foto con las detecciones de la IA' : 'Foto original'" />
        </div>

        @if (a.detections.length) {
          <div class="chips" aria-label="Detecciones">
            @for (d of a.detections; track $index) { <span class="chip">{{ d.label_es }} <strong>{{ d.confidence * 100 | number: '1.0-0' }}%</strong></span> }
          </div>
        }
        <div class="meta">
          @if (a.buoy.status !== 'no_detectada') { <span><i class="pi pi-compass"></i> Boya: {{ buoyLabel[a.buoy.status] }}@if (a.buoy.cage_saturation !== null) { · cesta {{ a.buoy.cage_saturation * 100 | number: '1.0-0' }}% llena }</span> }
          @if (a.scene?.[0]; as s) { <span><i class="pi pi-eye"></i> Escena: {{ s.label_es }} {{ s.probability * 100 | number: '1.0-0' }}%</span> }
          <span><i class="pi pi-clock"></i> {{ a.elapsed_ms | number: '1.0-0' }} ms · {{ a.model }}</span>
        </div>
        <p class="note"><i class="pi pi-info-circle" aria-hidden="true"></i><span>{{ a.note }}</span></p>
      }
    </section>
  `,
})
export class AiAnalysis {
  readonly analysis = input<VisionAnalysis | null | undefined>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** The unmodified photo; when given, the user can switch between it and the annotated image. */
  readonly original = input<string | null>(null);
  readonly retry = output<void>();

  protected readonly cat = signal(VISION_CATEGORY_META).asReadonly();
  protected readonly sev = signal(VISION_SEVERITY_META).asReadonly();
  protected readonly buoyLabel = BUOY_STATUS_LABEL;
  protected readonly views = [
    { label: 'Con detecciones', value: 'annotated' },
    { label: 'Foto original', value: 'original' },
  ];
  protected readonly view = signal<'annotated' | 'original'>('annotated');
  protected readonly shown = computed(() => (this.view() === 'original' && this.original() ? this.original()! : (this.analysis()?.annotated_image ?? '')));
}
