import { Injectable } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import { VisionAnalysis } from '../models/vision.models';
import { VisionApi } from '../api/vision-api';

/** Canned result for `useMocks` / `?mock=1` (no backend): echoes the photo as the "annotated" image. */
@Injectable()
export class MockVisionApi extends VisionApi {
  analyze(photo: string): Observable<VisionAnalysis> {
    return of<VisionAnalysis>({
      category: 'peces_muertos',
      severity: 'critica',
      summary: 'Peces muertos detectados: alerta ambiental crítica.',
      reasons: ['(Simulado) El clasificador de escena ve peces muertos en el agua (97 %).'],
      detections: [{ label: 'dead fish', label_es: 'Pez muerto', confidence: 0.61, bbox: [40, 60, 320, 200] }],
      buoy: { status: 'no_detectada', ring_found: false, barrier_count: 0, barrier_fragments: 0, barrier_balance: 0, cage_saturation: null },
      scene: [
        { label: 'peces_muertos', label_es: 'Peces muertos', probability: 0.97 },
        { label: 'otro', label_es: 'Otra escena', probability: 0.02 },
      ],
      annotated_image: photo,
      image: { width: 1024, height: 768 },
      model: 'simulado',
      elapsed_ms: 420,
      note: 'Resultado simulado: no se ejecutó ningún modelo.',
    }).pipe(delay(900));
  }
}
