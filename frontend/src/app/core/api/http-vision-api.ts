import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, timeout } from 'rxjs';
import { dataUrlToBlob } from '../../shared/utils/vision.util';
import { APP_CONFIG } from '../config/app-config';
import { SILENT_ERRORS } from '../interceptors/api-error.interceptor';
import { VisionAnalysis } from '../models/vision.models';
import { VisionApi } from './vision-api';

/** CPU inference + a slow mobile link: be patient, but not forever. */
const TIMEOUT_MS = 90_000;

@Injectable()
export class HttpVisionApi extends VisionApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  analyze(photo: string): Observable<VisionAnalysis> {
    const form = new FormData();
    form.append('file', dataUrlToBlob(photo), 'foto.jpg');
    // The AI is optional for a citizen: an inline message replaces the global error toast.
    return this.http
      .post<VisionAnalysis>(`${this.base}/vision/analyze`, form, { context: new HttpContext().set(SILENT_ERRORS, true) })
      .pipe(timeout({ first: TIMEOUT_MS }));
  }
}
