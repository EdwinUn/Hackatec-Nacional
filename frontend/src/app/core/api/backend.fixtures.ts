// Respuestas REALES del backend (capturadas de /api/v1 con datos de `make simulate`).
// Regenerar si cambia el contrato de /API.md.
/* eslint-disable */
export const BACKEND_FIXTURES = {
 "stations": {
  "items": [
   {
    "id": "eab40880-a325-4eef-b917-a9ccc30d8858",
    "name": "Presa de Valsequillo — Oasis / Embarcadero",
    "river": "Presa de Valsequillo",
    "latitude": 18.918,
    "longitude": -98.155,
    "status": "active",
    "installed_at": "2026-11-10",
    "description": "Boya prototipo en la presa Manuel Ávila Camacho (zona Oasis / Embarcadero).",
    "created_at": "2026-11-24T05:16:51.916772Z",
    "updated_at": "2026-11-24T05:16:51.916774Z"
   },
   {
    "id": "86a4390e-5526-439c-9c7c-45995ec85506",
    "name": "Río Alseseca — La Hacienda / Xilotzingo",
    "river": "Río Alseseca",
    "latitude": 18.995,
    "longitude": -98.188,
    "status": "active",
    "installed_at": "2026-11-05",
    "description": "Boya prototipo en el Alseseca (zona La Hacienda / Xilotzingo).",
    "created_at": "2026-11-24T05:16:51.886293Z",
    "updated_at": "2026-11-24T05:16:51.886295Z"
   }
  ],
  "total": 3,
  "limit": 500,
  "offset": 0
 },
 "overview": {
  "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
  "from": "2026-11-23T06:17:07.585539Z",
  "to": "2026-11-24T06:17:07.585539Z",
  "wqi": {
   "score": 75.6,
   "category": "buena",
   "dominant_parameter": "turbidity",
   "components": [
    {
     "parameter": "turbidity",
     "value": 57.207,
     "sub_index": 42.82,
     "weight": 0.25
    },
    {
     "parameter": "tds",
     "value": 759.033,
     "sub_index": 69.28,
     "weight": 0.05
    },
    {
     "parameter": "ph",
     "value": 7.462,
     "sub_index": 100.0,
     "weight": 0.25
    },
    {
     "parameter": "conductivity",
     "value": 1165.757,
     "sub_index": 73.37,
     "weight": 0.1
    },
    {
     "parameter": "dissolved_oxygen",
     "value": 5.515,
     "sub_index": 76.44,
     "weight": 0.25
    },
    {
     "parameter": "temperature",
     "value": 16.692,
     "sub_index": 100.0,
     "weight": 0.1
    }
   ]
  },
  "wqi_outlet": {
   "score": 93.8,
   "category": "excelente",
   "dominant_parameter": "conductivity",
   "components": [
    {
     "parameter": "ph",
     "value": 7.191,
     "sub_index": 100.0,
     "weight": 0.2941
    },
    {
     "parameter": "turbidity",
     "value": 3.604,
     "sub_index": 92.79,
     "weight": 0.2941
    },
    {
     "parameter": "conductivity",
     "value": 1072.496,
     "sub_index": 77.1,
     "weight": 0.1176
    },
    {
     "parameter": "dissolved_oxygen",
     "value": 7.16,
     "sub_index": 95.4,
     "weight": 0.2941
    }
   ]
  },
  "ph_inlet": {
   "value": 7.485,
   "ts": "2026-11-24T05:15:52.544208Z"
  },
  "ph_outlet": {
   "value": 7.191,
   "ts": "2026-11-24T05:15:52.544208Z"
  },
  "sensors_online": 0,
  "sensors_total": 12,
  "water_in_l": 24243.0,
  "water_clean_l": 21418.0,
  "sludge_kg": 78.68,
  "efficiency_pct": 88.35,
  "waste_kg": 44.05,
  "waste_items": 340,
  "cycles_running": 0,
  "alerts_open": 19,
  "alerts_critical_open": 2,
  "trend_bucket": "1h",
  "trend": [
   {
    "bucket": "2026-11-23T06:00:00Z",
    "wqi": 77.0,
    "ph_inlet": 7.325,
    "ph_outlet": 7.148,
    "water_clean_l": 1023.8
   },
   {
    "bucket": "2026-11-23T07:00:00Z",
    "wqi": 77.5,
    "ph_inlet": 7.361,
    "ph_outlet": 7.158,
    "water_clean_l": 1015.8
   },
   {
    "bucket": "2026-11-23T08:00:00Z",
    "wqi": 78.0,
    "ph_inlet": 7.402,
    "ph_outlet": 7.163,
    "water_clean_l": 1010.5
   },
   {
    "bucket": "2026-11-23T09:00:00Z",
    "wqi": 78.5,
    "ph_inlet": 7.46,
    "ph_outlet": 7.184,
    "water_clean_l": 953.1
   }
  ]
 },
 "ph": {
  "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
  "bucket": "1h",
  "points": [
   {
    "bucket": "2026-11-23T06:00:00Z",
    "inlet": {
     "avg": 7.325,
     "min": 7.215,
     "max": 7.42,
     "count": 43
    },
    "outlet": {
     "avg": 7.148,
     "min": 7.085,
     "max": 7.207,
     "count": 43
    }
   },
   {
    "bucket": "2026-11-23T07:00:00Z",
    "inlet": {
     "avg": 7.361,
     "min": 7.26,
     "max": 7.451,
     "count": 60
    },
    "outlet": {
     "avg": 7.158,
     "min": 7.093,
     "max": 7.218,
     "count": 60
    }
   },
   {
    "bucket": "2026-11-23T08:00:00Z",
    "inlet": {
     "avg": 7.402,
     "min": 7.314,
     "max": 7.49,
     "count": 60
    },
    "outlet": {
     "avg": 7.163,
     "min": 7.071,
     "max": 7.278,
     "count": 60
    }
   }
  ],
  "inlet_avg": 7.5,
  "outlet_avg": 7.19,
  "avg_shift_toward_neutral": 0.372
 },
 "water": {
  "total": {
   "batches": 46,
   "water_in_l": 24243.0,
   "water_clean_l": 21418.0,
   "water_lost_l": 2825.0,
   "sludge_kg": 78.68,
   "efficiency_pct": 88.35
  },
  "series": [
   {
    "batches": 2,
    "water_in_l": 1146.8,
    "water_clean_l": 1023.8,
    "water_lost_l": 123.0,
    "sludge_kg": 3.09,
    "efficiency_pct": 89.27,
    "bucket": "2026-11-23T06:00:00Z"
   },
   {
    "batches": 2,
    "water_in_l": 1103.7,
    "water_clean_l": 1015.8,
    "water_lost_l": 87.9,
    "sludge_kg": 3.14,
    "efficiency_pct": 92.04,
    "bucket": "2026-11-23T07:00:00Z"
   }
  ]
 },
 "waste": {
  "total_kg": 44.05,
  "total_items": 340,
  "by_type": [
   {
    "waste_type": "plastic",
    "weight_kg": 26.8,
    "items": 206,
    "collections": 18
   },
   {
    "waste_type": "organic",
    "weight_kg": 10.12,
    "items": 88,
    "collections": 6
   },
   {
    "waste_type": "other",
    "weight_kg": 3.74,
    "items": 26,
    "collections": 3
   },
   {
    "waste_type": "glass",
    "weight_kg": 2.98,
    "items": 19,
    "collections": 3
   },
   {
    "waste_type": "metal",
    "weight_kg": 0.41,
    "items": 1,
    "collections": 1
   }
  ],
  "series": [
   {
    "bucket": "2026-11-23T06:00:00Z",
    "waste_type": "glass",
    "weight_kg": 0.36,
    "items": 3
   },
   {
    "bucket": "2026-11-23T07:00:00Z",
    "waste_type": "metal",
    "weight_kg": 0.41,
    "items": 1
   }
  ]
 },
 "centrifuge": {
  "summary": {
   "cycles": 45,
   "completed": 45,
   "failed": 0,
   "running": 0,
   "failure_rate_pct": 0.0,
   "rpm_avg": 2845.06,
   "rpm_max": 3171.8,
   "vibration_avg_mm_s": 2.671,
   "vibration_max_mm_s": 3.59,
   "power_avg_w": 795.449,
   "energy_kwh": 11.932,
   "avg_duration_s": 1200.0
  },
  "series": [
   {
    "bucket": "2026-11-23T06:00:00Z",
    "cycles": 1,
    "failed": 0,
    "rpm_avg": 2948.1,
    "vibration_avg_mm_s": 2.93,
    "power_avg_w": 836.4
   }
  ]
 },
 "cycles": {
  "items": [
   {
    "id": "1b39004a-62c3-4dd5-ba09-8033c1d8acf6",
    "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
    "started_at": "2026-11-24T04:30:00Z",
    "ended_at": "2026-11-24T04:50:00Z",
    "status": "completed",
    "rpm_avg": 2866.4,
    "rpm_max": 3044.1,
    "vibration_mm_s": 2.28,
    "power_w": 801.8,
    "water_in_l": 465.6,
    "water_out_clean_l": 421.7,
    "sludge_kg": 1.41,
    "failure_reason": null,
    "duration_s": 1200.0,
    "created_at": "2026-11-24T05:17:04.979959Z",
    "updated_at": "2026-11-24T05:17:04.982578Z"
   }
  ],
  "total": 47,
  "limit": 1,
  "offset": 0
 },
 "sensorsHealth": [
  {
   "sensor_id": "8e637fb5-f103-46d7-b88f-cf1b72e74356",
   "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
   "station_name": "Río Atoyac — Parque Lineal / Echeverría",
   "type": "conductivity",
   "location": "inlet",
   "unit": "µS/cm",
   "status": "offline",
   "last_seen_at": "2026-11-24T05:15:52.544208Z",
   "last_value": 1165.757,
   "last_reading_at": "2026-11-24T05:15:52.544208Z",
   "readings_count": 1379,
   "avg_quality": 0.965,
   "uptime_pct": 96.18
  },
  {
   "sensor_id": "c5b2dc86-d767-4568-be79-1fed17a00c9c",
   "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
   "station_name": "Río Atoyac — Parque Lineal / Echeverría",
   "type": "dissolved_oxygen",
   "location": "inlet",
   "unit": "mg/L",
   "status": "offline",
   "last_seen_at": "2026-11-24T05:15:52.544208Z",
   "last_value": 5.515,
   "last_reading_at": "2026-11-24T05:15:52.544208Z",
   "readings_count": 1379,
   "avg_quality": 0.965,
   "uptime_pct": 96.18
  },
  {
   "sensor_id": "c4add425-bd25-4b19-bd8f-467b7d5515e2",
   "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
   "station_name": "Río Atoyac — Parque Lineal / Echeverría",
   "type": "ph",
   "location": "inlet",
   "unit": "pH",
   "status": "offline",
   "last_seen_at": "2026-11-24T05:15:52.544208Z",
   "last_value": 7.485,
   "last_reading_at": "2026-11-24T05:15:52.544208Z",
   "readings_count": 1379,
   "avg_quality": 0.965,
   "uptime_pct": 96.18
  }
 ],
 "hotspots": [
  {
   "station_id": "eab40880-a325-4eef-b917-a9ccc30d8858",
   "name": "Presa de Valsequillo — Oasis / Embarcadero",
   "river": "Presa de Valsequillo",
   "latitude": 18.918,
   "longitude": -98.155,
   "status": "active",
   "wqi": {
    "score": 86.3,
    "category": "buena",
    "dominant_parameter": "turbidity",
    "components": [
     {
      "parameter": "conductivity",
      "value": 818.483,
      "sub_index": 87.26,
      "weight": 0.1
     },
     {
      "parameter": "tds",
      "value": 552.825,
      "sub_index": 85.77,
      "weight": 0.05
     },
     {
      "parameter": "ph",
      "value": 7.935,
      "sub_index": 95.65,
      "weight": 0.25
     },
     {
      "parameter": "temperature",
      "value": 18.578,
      "sub_index": 100.0,
      "weight": 0.1
     },
     {
      "parameter": "turbidity",
      "value": 18.563,
      "sub_index": 69.66,
      "weight": 0.25
     },
     {
      "parameter": "dissolved_oxygen",
      "value": 6.414,
      "sub_index": 87.67,
      "weight": 0.25
     }
    ]
   },
   "alerts_open": 15,
   "alerts_critical_open": 1,
   "last_reading_at": "2026-11-24T05:15:52.544208Z"
  },
  {
   "station_id": "86a4390e-5526-439c-9c7c-45995ec85506",
   "name": "Río Alseseca — La Hacienda / Xilotzingo",
   "river": "Río Alseseca",
   "latitude": 18.995,
   "longitude": -98.188,
   "status": "active",
   "wqi": {
    "score": 81.3,
    "category": "buena",
    "dominant_parameter": "turbidity",
    "components": [
     {
      "parameter": "turbidity",
      "value": 42.424,
      "sub_index": 50.71,
      "weight": 0.25
     },
     {
      "parameter": "dissolved_oxygen",
      "value": 6.204,
      "sub_index": 85.05,
      "weight": 0.25
     },
     {
      "parameter": "conductivity",
      "value": 943.827,
      "sub_index": 82.25,
      "weight": 0.1
     },
     {
      "parameter": "ph",
      "value": 7.21,
      "sub_index": 100.0,
      "weight": 0.25
     },
     {
      "parameter": "temperature",
      "value": 15.668,
      "sub_index": 100.0,
      "weight": 0.1
     },
     {
      "parameter": "tds",
      "value": 591.603,
      "sub_index": 82.67,
      "weight": 0.05
     }
    ]
   },
   "alerts_open": 19,
   "alerts_critical_open": 3,
   "last_reading_at": "2026-11-24T05:15:52.544208Z"
  },
  {
   "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
   "name": "Río Atoyac — Parque Lineal / Echeverría",
   "river": "Río Atoyac",
   "latitude": 19.0185,
   "longitude": -98.2435,
   "status": "active",
   "wqi": {
    "score": 75.6,
    "category": "buena",
    "dominant_parameter": "turbidity",
    "components": [
     {
      "parameter": "turbidity",
      "value": 57.207,
      "sub_index": 42.82,
      "weight": 0.25
     },
     {
      "parameter": "tds",
      "value": 759.033,
      "sub_index": 69.28,
      "weight": 0.05
     },
     {
      "parameter": "ph",
      "value": 7.462,
      "sub_index": 100.0,
      "weight": 0.25
     },
     {
      "parameter": "conductivity",
      "value": 1165.757,
      "sub_index": 73.37,
      "weight": 0.1
     },
     {
      "parameter": "dissolved_oxygen",
      "value": 5.515,
      "sub_index": 76.44,
      "weight": 0.25
     },
     {
      "parameter": "temperature",
      "value": 16.692,
      "sub_index": 100.0,
      "weight": 0.1
     }
    ]
   },
   "alerts_open": 19,
   "alerts_critical_open": 2,
   "last_reading_at": "2026-11-24T05:15:52.544208Z"
  }
 ],
 "alerts": {
  "items": [
   {
    "id": "9611a9f6-6147-46fa-84ba-c95e71d32f13",
    "rule_id": "9a5e2d5a-a167-4210-9210-e4cb5d4b25bf",
    "station_id": "86a4390e-5526-439c-9c7c-45995ec85506",
    "sensor_id": null,
    "subject_key": "station:86a4390e-5526-439c-9c7c-45995ec85506",
    "kind": "centrifuge_vibration",
    "parameter": null,
    "severity": "critical",
    "status": "open",
    "message": "Vibración peligrosa en centrífuga: 8.64 mm/s (máx 7.1)",
    "trigger_value": 8.64,
    "threshold_min": null,
    "threshold_max": 7.1,
    "first_triggered_at": "2026-11-24T03:38:00Z",
    "last_triggered_at": "2026-11-24T03:38:00Z",
    "occurrences": 1,
    "acknowledged_at": null,
    "resolved_at": null,
    "note": null
   },
   {
    "id": "90b1b3d2-43e2-4fb3-8193-d5b83d91c97f",
    "rule_id": "1ca37394-b9d9-4cc6-afce-5edcf3a7862d",
    "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
    "sensor_id": "86dbf8e0-f668-41b9-bc9a-b8abcfa6f52f",
    "subject_key": "sensor:86dbf8e0-f668-41b9-bc9a-b8abcfa6f52f",
    "kind": "reading_range",
    "parameter": "ph",
    "severity": "critical",
    "status": "open",
    "message": "pH extremo: 5.46 pH (mín 5.5, máx 9.5)",
    "trigger_value": 5.46,
    "threshold_min": 5.5,
    "threshold_max": 9.5,
    "first_triggered_at": "2026-11-24T02:26:52.544208Z",
    "last_triggered_at": "2026-11-24T02:50:52.544208Z",
    "occurrences": 25,
    "acknowledged_at": null,
    "resolved_at": null,
    "note": null
   }
  ],
  "total": 6,
  "limit": 2,
  "offset": 0
 },
 "rules": [
  {
   "id": "9a5e2d5a-a167-4210-9210-e4cb5d4b25bf",
   "name": "Vibración peligrosa en centrífuga",
   "kind": "centrifuge_vibration",
   "severity": "critical",
   "parameter": null,
   "location": null,
   "station_id": null,
   "min_value": null,
   "max_value": 7.1,
   "enabled": true,
   "description": "Prototipo. Zona de daño posible según la misma escala; detener y revisar balanceo.",
   "created_at": "2026-11-24T05:16:51.947243Z",
   "updated_at": "2026-11-24T05:16:51.947243Z"
  },
  {
   "id": "850918cc-3f95-4e89-8bc8-b03f853a0584",
   "name": "Vibración elevada en centrífuga",
   "kind": "centrifuge_vibration",
   "severity": "warning",
   "parameter": null,
   "location": null,
   "station_id": null,
   "min_value": null,
   "max_value": 4.5,
   "enabled": true,
   "description": "Prototipo. Inspirado en zonas de severidad de vibración (mm/s RMS) de ISO 10816 para máquinas pequeñas; calibrar con el equipo real.",
   "created_at": "2026-11-24T05:16:51.947240Z",
   "updated_at": "2026-11-24T05:16:51.947240Z"
  },
  {
   "id": "fb131e32-41de-49e0-9d12-2b353c377345",
   "name": "Conductividad alta",
   "kind": "reading_range",
   "severity": "warning",
   "parameter": "conductivity",
   "location": null,
   "station_id": null,
   "min_value": null,
   "max_value": 1500.0,
   "enabled": true,
   "description": "Prototipo. Valores altos sugieren sales/descargas; ajustar a la línea base de cada río.",
   "created_at": "2026-11-24T05:16:51.947230Z",
   "updated_at": "2026-11-24T05:16:51.947230Z"
  },
  {
   "id": "bc105458-7307-4cc1-a6e2-14ee0dcc1ce6",
   "name": "Hipoxia",
   "kind": "reading_range",
   "severity": "critical",
   "parameter": "dissolved_oxygen",
   "location": null,
   "station_id": null,
   "min_value": 2.0,
   "max_value": null,
   "enabled": true,
   "description": "Prototipo. < 2 mg/L es la definición usual de hipoxia.",
   "created_at": "2026-11-24T05:16:51.947223Z",
   "updated_at": "2026-11-24T05:16:51.947223Z"
  },
  {
   "id": "4bcf203d-4c32-4016-8fd8-a4029dd58caf",
   "name": "Oxígeno disuelto bajo",
   "kind": "reading_range",
   "severity": "warning",
   "parameter": "dissolved_oxygen",
   "location": null,
   "station_id": null,
   "min_value": 5.0,
   "max_value": null,
   "enabled": true,
   "description": "Prototipo. Por debajo de ~5 mg/L muchas especies acuáticas presentan estrés (criterio común en guías de vida acuática).",
   "created_at": "2026-11-24T05:16:51.947219Z",
   "updated_at": "2026-11-24T05:16:51.947220Z"
  },
  {
   "id": "1ca37394-b9d9-4cc6-afce-5edcf3a7862d",
   "name": "pH extremo",
   "kind": "reading_range",
   "severity": "critical",
   "parameter": "ph",
   "location": null,
   "station_id": null,
   "min_value": 5.5,
   "max_value": 9.5,
   "enabled": true,
   "description": "Prototipo. Margen de ±1 unidad fuera del rango aceptable; indica una posible descarga ácida/alcalina.",
   "created_at": "2026-11-24T05:16:51.947204Z",
   "updated_at": "2026-11-24T05:16:51.947204Z"
  },
  {
   "id": "c2adc08f-1ece-43c7-87b3-b6052cdaf99b",
   "name": "pH fuera del rango aceptable",
   "kind": "reading_range",
   "severity": "warning",
   "parameter": "ph",
   "location": null,
   "station_id": null,
   "min_value": 6.5,
   "max_value": 8.5,
   "enabled": true,
   "description": "Prototipo. 6.5–8.5 es el rango aceptable usado por guías de agua (p. ej. NOM-127-SSA1, guías secundarias de la EPA).",
   "created_at": "2026-11-24T05:16:51.947196Z",
   "updated_at": "2026-11-24T05:16:51.947197Z"
  },
  {
   "id": "ddaaecdd-99a0-4e0b-b7b7-f42dfd02b32f",
   "name": "Sólidos disueltos totales altos",
   "kind": "reading_range",
   "severity": "warning",
   "parameter": "tds",
   "location": null,
   "station_id": null,
   "min_value": null,
   "max_value": 1000.0,
   "enabled": true,
   "description": "Prototipo. Orden de magnitud del límite de SDT en normas de agua de consumo (~1000 mg/L).",
   "created_at": "2026-11-24T05:16:51.947234Z",
   "updated_at": "2026-11-24T05:16:51.947234Z"
  },
  {
   "id": "d9bb8764-61ba-4510-9d1c-f5586ed43b28",
   "name": "Temperatura anómala",
   "kind": "reading_range",
   "severity": "info",
   "parameter": "temperature",
   "location": null,
   "station_id": null,
   "min_value": 10.0,
   "max_value": 30.0,
   "enabled": true,
   "description": "Prototipo. Rango plausible para ríos del altiplano poblano; ajustar con datos históricos.",
   "created_at": "2026-11-24T05:16:51.947227Z",
   "updated_at": "2026-11-24T05:16:51.947227Z"
  },
  {
   "id": "b675464b-a9e4-4aaf-8b0c-f8b72d805d00",
   "name": "Turbidez alta a la salida",
   "kind": "reading_range",
   "severity": "warning",
   "parameter": "turbidity",
   "location": "outlet",
   "station_id": null,
   "min_value": null,
   "max_value": 5.0,
   "enabled": true,
   "description": "Prototipo. Meta de salida inspirada en el orden de magnitud de normas de agua de consumo (~4–5 NTU); el filtro no está cumpliendo.",
   "created_at": "2026-11-24T05:16:51.947214Z",
   "updated_at": "2026-11-24T05:16:51.947214Z"
  },
  {
   "id": "7d57db72-30f3-4735-92c0-ddf863da684e",
   "name": "Turbidez alta en el río/entrada",
   "kind": "reading_range",
   "severity": "warning",
   "parameter": "turbidity",
   "location": "inlet",
   "station_id": null,
   "min_value": null,
   "max_value": 100.0,
   "enabled": true,
   "description": "Prototipo. El agua superficial varía mucho; 100 NTU marca un pico de sedimentos/contaminación respecto a la línea base esperada.",
   "created_at": "2026-11-24T05:16:51.947209Z",
   "updated_at": "2026-11-24T05:16:51.947210Z"
  },
  {
   "id": "2bfe8943-aa8c-4a45-a188-210ca704099e",
   "name": "Sensor sin señal",
   "kind": "sensor_offline",
   "severity": "warning",
   "parameter": null,
   "location": null,
   "station_id": null,
   "min_value": null,
   "max_value": 10.0,
   "enabled": true,
   "description": "Prototipo. Minutos sin reportar antes de considerar el sensor caído.",
   "created_at": "2026-11-24T05:16:51.947237Z",
   "updated_at": "2026-11-24T05:16:51.947237Z"
  },
  {
   "id": "3930bf3c-69b4-4251-874c-861bd7c9f870",
   "name": "Eficiencia de recuperación baja",
   "kind": "treatment_efficiency",
   "severity": "warning",
   "parameter": null,
   "location": null,
   "station_id": null,
   "min_value": 70.0,
   "max_value": null,
   "enabled": true,
   "description": "Prototipo. Menos de 70% del agua regresa limpia: revisar filtros.",
   "created_at": "2026-11-24T05:16:51.947247Z",
   "updated_at": "2026-11-24T05:16:51.947247Z"
  }
 ],
 "forecast": {
  "station_id": "80f03714-75e7-4448-a9b2-78620d31dd80",
  "location": "inlet",
  "method": "Regresión lineal (mínimos cuadrados) sobre promedios de 15 min; banda ±1.96·σ de residuos. Valor de prototipo.",
  "lookback_hours": 6,
  "horizon_hours": 2,
  "samples": 21,
  "slope_per_hour": 0.0082,
  "residual_std": 0.6842,
  "history": [
   {
    "ts": "2026-11-24T00:15:00Z",
    "value": 7.54
   },
   {
    "ts": "2026-11-24T00:30:00Z",
    "value": 7.541
   },
   {
    "ts": "2026-11-24T00:45:00Z",
    "value": 7.554
   }
  ],
  "points": [
   {
    "ts": "2026-11-24T05:30:00Z",
    "value": 7.257,
    "lower": 5.916,
    "upper": 8.598
   },
   {
    "ts": "2026-11-24T05:45:00Z",
    "value": 7.259,
    "lower": 5.918,
    "upper": 8.6
   },
   {
    "ts": "2026-11-24T06:00:00Z",
    "value": 7.261,
    "lower": 5.92,
    "upper": 8.602
   },
   {
    "ts": "2026-11-24T06:15:00Z",
    "value": 7.263,
    "lower": 5.922,
    "upper": 8.604
   },
   {
    "ts": "2026-11-24T06:30:00Z",
    "value": 7.265,
    "lower": 5.925,
    "upper": 8.606
   },
   {
    "ts": "2026-11-24T06:45:00Z",
    "value": 7.268,
    "lower": 5.927,
    "upper": 8.608
   },
   {
    "ts": "2026-11-24T07:00:00Z",
    "value": 7.27,
    "lower": 5.929,
    "upper": 8.611
   },
   {
    "ts": "2026-11-24T07:15:00Z",
    "value": 7.272,
    "lower": 5.931,
    "upper": 8.613
   }
  ],
  "note": null
 }
} as const;
