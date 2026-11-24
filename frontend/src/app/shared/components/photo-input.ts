import { ChangeDetectionStrategy, Component, ElementRef, input, model, signal, viewChild } from '@angular/core';
import { Button } from 'primeng/button';
import { compressImage } from '../utils/image.util';

/** Take/choose a photo (opens the camera on phones), compressed to a JPEG data URL. */
@Component({
  selector: 'app-photo-input',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem; min-height: 140px; border: 2px dashed var(--rm-border); border-radius: 10px; padding: 1rem; text-align: center; color: var(--rm-muted); cursor: pointer; background: #fafbfa; width: 100%; font: inherit; }
    .drop:hover { border-color: var(--rm-green); color: var(--rm-green); }
    .drop i { font-size: 1.8rem; }
    .preview { position: relative; }
    .preview img { width: 100%; max-height: 260px; object-fit: cover; border-radius: 10px; display: block; }
    .preview .actions { position: absolute; right: .5rem; top: .5rem; display: flex; gap: .35rem; }
    input[type=file] { display: none; }
    .err { color: #b91c1c; font-size: .8rem; margin: .35rem 0 0; }
  `,
  template: `
    <input #file type="file" accept="image/*" capture="environment" (change)="onFile($event)" />
    @if (value(); as v) {
      <div class="preview">
        <img [src]="v" [alt]="label()" />
        <div class="actions">
          <p-button icon="pi pi-camera" [rounded]="true" size="small" severity="secondary" ariaLabel="Cambiar foto" (onClick)="file.click()" />
          <p-button icon="pi pi-trash" [rounded]="true" size="small" severity="danger" ariaLabel="Quitar foto" (onClick)="value.set(null)" />
        </div>
      </div>
    } @else {
      <button type="button" class="drop" (click)="file.click()" [disabled]="busy()">
        <i [class]="busy() ? 'pi pi-spin pi-spinner' : 'pi pi-camera'" aria-hidden="true"></i>
        <strong>{{ label() }}</strong>
        <small>Toma una foto o elige una de tu galería</small>
      </button>
    }
    @if (error()) { <p class="err">{{ error() }}</p> }
  `,
})
export class PhotoInput {
  readonly value = model<string | null>(null);
  readonly label = input('Agregar foto');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly file = viewChild.required<ElementRef<HTMLInputElement>>('file');

  protected async onFile(e: Event): Promise<void> {
    const f = (e.target as HTMLInputElement).files?.[0];
    this.file().nativeElement.value = '';
    if (!f) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.value.set(await compressImage(f));
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
