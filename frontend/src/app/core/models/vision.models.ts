/**
 * Wire schema of `POST /api/v1/vision/analyze` — copied from `API.md` (§ Visión artificial).
 * Note: `severity` here is Spanish (`critica|alta|media|baja`), unlike the alerts' severity.
 */
export type VisionCategory = 'peces_muertos' | 'boya_defectuosa' | 'boya_saturada' | 'acumulacion_basura' | 'normal';
export type VisionSeverity = 'critica' | 'alta' | 'media' | 'baja';
export type VisionBuoyStatus = 'no_detectada' | 'integra' | 'saturada' | 'defectuosa';

export interface VisionDetection {
  /** Detector prompt in English, e.g. `dead fish`. */
  label: string;
  label_es: string;
  confidence: number;
  /** `[x1, y1, x2, y2]` in pixels of the analysed image (`image`). */
  bbox: [number, number, number, number];
}

export interface VisionBuoy {
  status: VisionBuoyStatus;
  ring_found: boolean;
  barrier_count: number;
  barrier_fragments: number;
  barrier_balance: number;
  /** 0–1 fraction of the cage covered by trash; `null` when the cage is not visible. */
  cage_saturation: number | null;
}

export interface VisionSceneScore {
  label: string;
  label_es: string;
  probability: number;
}

export interface VisionAnalysis {
  category: VisionCategory;
  severity: VisionSeverity;
  summary: string;
  reasons: string[];
  detections: VisionDetection[];
  buoy: VisionBuoy;
  /** Scene classifier (CLIP), most likely first; `null` when disabled on the server. */
  scene: VisionSceneScore[] | null;
  /** `data:image/jpeg;base64,…` with the boxes drawn. */
  annotated_image: string;
  image: { width: number; height: number };
  model: string;
  elapsed_ms: number;
  note: string;
}
