import { ReportType } from '../../core/models/ops.models';
import { VisionBuoyStatus, VisionCategory, VisionSeverity } from '../../core/models/vision.models';

export const VISION_CATEGORY_META: Record<VisionCategory, { label: string; icon: string }> = {
  peces_muertos: { label: 'Peces muertos', icon: 'pi pi-exclamation-triangle' },
  boya_defectuosa: { label: 'Boya skimmer dañada', icon: 'pi pi-wrench' },
  boya_saturada: { label: 'Cesta de la boya saturada', icon: 'pi pi-inbox' },
  acumulacion_basura: { label: 'Acumulación de basura', icon: 'pi pi-trash' },
  normal: { label: 'Sin problemas detectados', icon: 'pi pi-check-circle' },
};

export const VISION_SEVERITY_META: Record<VisionSeverity, { label: string; color: string; bg: string }> = {
  critica: { label: 'Crítica', color: '#b91c1c', bg: '#fbdcdc' },
  alta: { label: 'Alta', color: '#c2410c', bg: '#fde4d3' },
  media: { label: 'Media', color: '#a16207', bg: '#fcefc7' },
  baja: { label: 'Baja', color: '#0f7a4d', bg: '#dcf5e8' },
};

export const BUOY_STATUS_LABEL: Record<VisionBuoyStatus, string> = {
  no_detectada: 'No se ve la boya',
  integra: 'Íntegra',
  saturada: 'Saturada',
  defectuosa: 'Dañada',
};

/** Citizen-report type that best matches what the AI saw (`null` = nothing to suggest). */
export function reportTypeFor(category: VisionCategory): ReportType | null {
  switch (category) {
    case 'peces_muertos':
      return 'dead_fish';
    case 'acumulacion_basura':
      return 'trash';
    case 'boya_defectuosa':
    case 'boya_saturada':
      return 'other';
    default:
      return null;
  }
}

/** `data:image/jpeg;base64,…` → Blob (to upload it as `multipart/form-data`). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body = ''] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Re-encodes a data-URL image smaller (longest side `maxSide`) so the annotated picture
 * (~300 KB from the server) fits the browser's local storage next to the report.
 */
export async function shrinkDataUrl(dataUrl: string, maxSide = 640, quality = 0.6): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
