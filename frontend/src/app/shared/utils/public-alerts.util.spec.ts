import { Alert } from '../../core/models/rio.models';
import { isPublicAlert, publicNotices, toPublicNotice } from './public-alerts.util';

function alert(p: Partial<Alert>): Alert {
  return {
    id: 'a', station_id: 's1', station_name: 'Atoyac — Puente', severity: 'warning', status: 'open', message: 'msg',
    parameter: 'ph', value: 5.2, created_at: '2026-11-24T10:00:00Z', occurrences: 1, acknowledged_at: null, resolved_at: null, note: null,
    ...p,
  };
}

describe('public alerts', () => {
  it('only open warning/critical alerts on measured water-quality parameters are public', () => {
    expect(isPublicAlert(alert({ parameter: 'ph' }))).toBe(true);
    expect(isPublicAlert(alert({ parameter: 'turbidity', severity: 'critical' }))).toBe(true);
    expect(isPublicAlert(alert({ parameter: 'tds' }))).toBe(true);
    expect(isPublicAlert(alert({ parameter: 'temperature' }))).toBe(true);
  });

  it('hides technical, informative, closed and earlier-concept alerts', () => {
    expect(isPublicAlert(alert({ parameter: null }))).toBe(false); // sensor offline, battery, basket…
    expect(isPublicAlert(alert({ parameter: 'dissolved_oxygen' }))).toBe(false);
    expect(isPublicAlert(alert({ parameter: 'conductivity' }))).toBe(false);
    expect(isPublicAlert(alert({ severity: 'info' }))).toBe(false);
    expect(isPublicAlert(alert({ status: 'resolved' }))).toBe(false);
    expect(isPublicAlert(alert({ status: 'acknowledged' }))).toBe(false);
  });

  it('writes the notice in plain language with the place and advice', () => {
    const n = toPublicNotice(alert({ severity: 'critical', parameter: 'ph' }))!;
    expect(n.level).toBe('critical');
    expect(n.place).toBe('Atoyac — Puente');
    expect(n.title).toContain('acidez');
    expect(n.advice).toContain('Evita tocar el agua');
    expect(toPublicNotice(alert({ parameter: null }))).toBeNull();
  });

  it('sorts critical first, then most recent', () => {
    const list = publicNotices([
      alert({ id: 'old-warn', parameter: 'tds', created_at: '2026-11-24T08:00:00Z' }),
      alert({ id: 'tech', parameter: null, severity: 'critical' }),
      alert({ id: 'new-warn', parameter: 'turbidity', created_at: '2026-11-24T12:00:00Z' }),
      alert({ id: 'crit', severity: 'critical', created_at: '2026-11-24T01:00:00Z' }),
    ]);
    expect(list.map((n) => n.id)).toEqual(['crit', 'new-warn', 'old-warn']);
  });

  it('folds repeated alerts of the same place and parameter into one notice', () => {
    const list = publicNotices([
      alert({ id: 'w1', created_at: '2026-11-24T08:00:00Z' }),
      alert({ id: 'c1', severity: 'critical', created_at: '2026-11-24T07:00:00Z' }),
      alert({ id: 'w2', created_at: '2026-11-24T09:00:00Z' }),
      alert({ id: 'other-param', parameter: 'turbidity' }),
      alert({ id: 'other-place', station_id: 's2', station_name: 'Alseseca' }),
    ]);
    expect(list).toHaveLength(3);
    const ph = list.find((n) => n.place === 'Atoyac — Puente' && n.title.includes('acidez'))!;
    expect(ph).toMatchObject({ id: 'c1', level: 'critical', count: 3 });
  });
});
