export const SENSOR_TYPE_LABEL: Record<string, string> = {
  ph: 'pH',
  turbidity: 'Turbidez',
  temperature: 'Temperatura',
  dissolved_oxygen: 'Oxígeno disuelto',
  conductivity: 'Conductividad',
  tds: 'SDT',
};

export const SENSOR_LOCATION_LABEL: Record<string, string> = {
  inlet: 'entrada',
  outlet: 'salida',
  river: 'río',
};

export const typeLabel = (t: string | null | undefined): string => (t ? (SENSOR_TYPE_LABEL[t] ?? t) : '—');
export const locationLabel = (l: string | null | undefined): string => (l ? (SENSOR_LOCATION_LABEL[l] ?? l) : '—');
