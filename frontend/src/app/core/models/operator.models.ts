/** Brigade operator module: tasks inbox and skimmer-buoy collection log (see `API.md`, «Personal operativo»). */
export type TaskView = 'asignadas' | 'reparaciones_pendientes' | 'urgentes' | 'listos';
export type TaskKind = 'report' | 'repair' | 'skimmer_collection' | 'maintenance';
export type TaskStatus = 'pending' | 'in_progress' | 'done';
export type TaskPriority = 'normal' | 'urgent';
export type BuoyCondition = 'ok' | 'danada' | 'saturada' | 'faltan_piezas';
export type Material = 'plastico' | 'organico' | 'vidrio' | 'otros' | 'metal';

export interface OperatorTask {
  id: string;
  title: string;
  description: string;
  kind: TaskKind;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to: string | null;
  station_id: string | null;
  buoy_code: string | null;
  closing_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskCounts = Record<TaskView, number>;

export interface TaskPage {
  items: OperatorTask[];
  total: number;
  counts: TaskCounts;
}

export interface TaskPatch {
  status?: TaskStatus;
  closing_note?: string;
  priority?: TaskPriority;
  assigned_to?: string | null;
}

export interface MaterialAmount {
  kg: number;
  piezas: number;
}

export interface NewCollection extends Record<Material, MaterialAmount> {
  station_id: string;
  buoy_code: string;
  buoy_condition: BuoyCondition;
  notes?: string | null;
  task_id?: string | null;
}

export interface Collection {
  id: string;
  station_id: string;
  ts: string;
  buoy_code: string;
  buoy_condition: BuoyCondition;
  total_kg: number;
  total_pieces: number;
  operator_name: string | null;
}
