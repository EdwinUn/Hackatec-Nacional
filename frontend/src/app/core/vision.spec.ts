import { HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { dataUrlToBlob, reportTypeFor } from '../shared/utils/vision.util';
import { HttpVisionApi } from './api/http-vision-api';
import { APP_CONFIG } from './config/app-config';
import { apiErrorInterceptor } from './interceptors/api-error.interceptor';
import { MockVisionApi } from './mock/mock-vision-api';
import { VisionAnalysis } from './models/vision.models';

const PHOTO = 'data:image/jpeg;base64,' + btoa('fake-jpeg-bytes');
const RESULT: VisionAnalysis = {
  category: 'peces_muertos',
  severity: 'critica',
  summary: 'Peces muertos detectados: alerta ambiental crítica.',
  reasons: [],
  detections: [{ label: 'dead fish', label_es: 'Pez muerto', confidence: 0.62, bbox: [1, 2, 3, 4] }],
  buoy: { status: 'no_detectada', ring_found: false, barrier_count: 0, barrier_fragments: 0, barrier_balance: 0, cage_saturation: null },
  scene: null,
  annotated_image: 'data:image/jpeg;base64,AAAA',
  image: { width: 10, height: 10 },
  model: 'yolov8s-worldv2',
  elapsed_ms: 1,
  note: 'n',
};

describe('vision utils', () => {
  it('turns a data URL into a Blob with its mime type and bytes', async () => {
    const blob = dataUrlToBlob(PHOTO);
    expect(blob.type).toBe('image/jpeg');
    expect(await blob.text()).toBe('fake-jpeg-bytes');
  });

  it('suggests the report type that matches the AI category', () => {
    expect(reportTypeFor('peces_muertos')).toBe('dead_fish');
    expect(reportTypeFor('acumulacion_basura')).toBe('trash');
    expect(reportTypeFor('boya_defectuosa')).toBe('other');
    expect(reportTypeFor('boya_saturada')).toBe('other');
    expect(reportTypeFor('normal')).toBeNull();
  });
});

describe('HttpVisionApi', () => {
  let http: HttpTestingController;
  let toast: { add: ReturnType<typeof vi.fn> };
  let api: HttpVisionApi;

  beforeEach(() => {
    toast = { add: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: MessageService, useValue: toast },
        { provide: APP_CONFIG, useValue: { useMocks: false, apiBaseUrl: 'http://api/v1', wsUrl: '', ingestApiKey: '', opsMocks: true } },
        HttpVisionApi,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(HttpVisionApi);
  });

  it('uploads the photo as multipart `file`, with no API key (open endpoint)', async () => {
    const done = firstValueFrom(api.analyze(PHOTO));
    const req = http.expectOne('http://api/v1/vision/analyze');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('X-API-Key')).toBe(false);
    const file = (req.request.body as FormData).get('file') as File;
    expect(file.type).toBe('image/jpeg');
    expect(await file.text()).toBe('fake-jpeg-bytes');
    req.flush(RESULT);
    expect((await done).category).toBe('peces_muertos');
  });

  it('surfaces backend errors WITHOUT the global toast (the form shows its own message)', async () => {
    const done = firstValueFrom(api.analyze(PHOTO)).catch((e: Error) => e);
    http.expectOne('http://api/v1/vision/analyze').flush(
      { error: { code: 'vision_unavailable', message: 'Falta el extra de visión', details: null } },
      { status: 503, statusText: 'Service Unavailable' } satisfies Partial<HttpErrorResponse>,
    );
    const err = (await done) as Error & { status: number; code: string };
    expect(err.message).toBe('Falta el extra de visión');
    expect(err.status).toBe(503);
    expect(err.code).toBe('vision_unavailable');
    expect(toast.add).not.toHaveBeenCalled();
  });
});

describe('MockVisionApi', () => {
  it('returns a canned analysis that echoes the photo', async () => {
    TestBed.configureTestingModule({ providers: [MockVisionApi] });
    const r = await firstValueFrom(TestBed.inject(MockVisionApi).analyze(PHOTO));
    expect(r.annotated_image).toBe(PHOTO);
    expect(r.model).toBe('simulado');
  });
});
