import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { OpsApi } from '../api/ops-api';
import { RioApi } from '../api/rio-api';
import { AuthService } from '../auth/auth.service';
import { GeoPoint, WorkOrder, WorkOrderPatch, WorkResult } from '../models/ops.models';
import { stationStatusFor } from '../../shared/utils/ops.util';

/**
 * Work-order lifecycle with its side effects on the monitoring backend
 * (endpoints that already exist in `API.md`):
 * - maintenance: `PATCH /stations/{id}` → `maintenance` on start, `active` on finish/cancel.
 * - waste_collection: `POST /waste-collections` with the weight recorded → shows up in the Resumen.
 * - calibration: `PATCH /sensors/{id}` with offset/factor.
 * A failing side effect does not block the order (the technician is in the field); it is reported back.
 */
@Injectable({ providedIn: 'root' })
export class WorkOrdersService {
  private readonly ops = inject(OpsApi);
  private readonly rio = inject(RioApi);
  private readonly auth = inject(AuthService);

  /** Check-in with the GPS position and start the order. */
  start(o: WorkOrder, at: GeoPoint | null): Observable<{ order: WorkOrder; warning: string | null }> {
    const patch: WorkOrderPatch = { status: 'in_progress', check_in: at ? { ...at, ts: new Date().toISOString() } : null };
    return this.withStation(o, 'in_progress', this.ops.patchWorkOrder(o.id, patch));
  }

  /** Close the order: records the result, runs the side effect, then marks it `done`. */
  finish(o: WorkOrder, patch: WorkOrderPatch): Observable<{ order: WorkOrder; warning: string | null }> {
    const result = patch.result ?? o.result;
    const effect$ = this.sideEffect(o, result).pipe(
      map(() => null as string | null),
      catchError((e: Error) => of(`La orden se cerró, pero no se pudo registrar en el sistema de monitoreo: ${e.message}`)),
    );
    return effect$.pipe(
      switchMap((warning) =>
        this.withStation(o, 'done', this.ops.patchWorkOrder(o.id, { ...patch, status: 'done' })).pipe(
          map((r) => ({ order: r.order, warning: warning ?? r.warning })),
        ),
      ),
    );
  }

  cancel(o: WorkOrder): Observable<{ order: WorkOrder; warning: string | null }> {
    return this.withStation(o, 'cancelled', this.ops.patchWorkOrder(o.id, { status: 'cancelled' }));
  }

  private sideEffect(o: WorkOrder, r: WorkResult | null): Observable<unknown> {
    if (!o.station_id || !r) return of(null);
    if (o.type === 'waste_collection' && r.weight_kg && r.waste_type) {
      const collector = this.auth.user()?.email ?? 'brigada';
      return this.rio.recordWasteCollection(o.station_id, r.waste_type, r.weight_kg, r.items_count ?? 0, collector);
    }
    if (o.type === 'calibration' && r.sensor_id && r.calibration_offset !== undefined) {
      return this.rio.calibrateSensor(r.sensor_id, r.calibration_offset, r.calibration_factor ?? 1);
    }
    return of(null);
  }

  /** Runs the order PATCH and then updates the station status when it applies. */
  private withStation(o: WorkOrder, next: WorkOrder['status'], patch$: Observable<WorkOrder>): Observable<{ order: WorkOrder; warning: string | null }> {
    const status = stationStatusFor(o, next);
    return patch$.pipe(
      switchMap((order) => {
        if (!status || !o.station_id) return of({ order, warning: null });
        return this.rio.setStationStatus(o.station_id, status).pipe(
          map(() => ({ order, warning: null as string | null })),
          catchError((e: Error) => of({ order, warning: `No se pudo cambiar el estado de la estación: ${e.message}` })),
        );
      }),
    );
  }
}
