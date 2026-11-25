import { Observable } from 'rxjs';
import { VisionAnalysis } from '../models/vision.models';

/** AI analysis of a citizen's photo (`POST /api/v1/vision/analyze`, open: no API key). */
export abstract class VisionApi {
  /** `photo` is a JPEG/PNG data URL (what the photo input produces). */
  abstract analyze(photo: string): Observable<VisionAnalysis>;
}
