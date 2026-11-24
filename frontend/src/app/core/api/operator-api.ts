import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { Collection, NewCollection, OperatorTask, TaskPage, TaskPatch, TaskView } from '../models/operator.models';

/** Real backend of the brigade module. The bearer token is added by `authInterceptor`. */
@Injectable({ providedIn: 'root' })
export class OperatorApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  /** `GET /tasks?view=` (+ `counts` for every tab). */
  tasks(view?: TaskView): Observable<TaskPage> {
    let params = new HttpParams().set('limit', 100);
    if (view) params = params.set('view', view);
    return this.http.get<TaskPage>(`${this.base}/tasks`, { params });
  }

  /** Attend (`in_progress`) or resolve (`done` + `closing_note`). */
  patchTask(id: string, body: TaskPatch): Observable<OperatorTask> {
    return this.http.patch<OperatorTask>(`${this.base}/tasks/${id}`, body);
  }

  /** `POST /skimmers/recoleccion`: weighs one buoy emptying; the dashboard card updates over the WebSocket. */
  recordCollection(body: NewCollection): Observable<Collection> {
    return this.http.post<Collection>(`${this.base}/skimmers/recoleccion`, body);
  }
}
