"""Evaluación de reglas de alerta. Devuelve alertas *candidatas*.

Anti-spam: cada alerta lleva `subject_key` (qué la disparó). La persistencia garantiza
una sola alerta abierta/reconocida por (rule_id, subject_key); una repetición solo
incrementa `occurrences` y actualiza el último valor.
"""

from collections.abc import Iterable
from datetime import datetime

from app.domain.entities import Alert, AlertRule, CentrifugeCycle, Sensor, TreatmentBatch
from app.domain.enums import RuleKind


def _out_of_bounds(rule: AlertRule, value: float) -> bool:
    return (rule.min_value is not None and value < rule.min_value) or (
        rule.max_value is not None and value > rule.max_value
    )


def _describe(rule: AlertRule, value: float, unit: str = "") -> str:
    bounds = []
    if rule.min_value is not None:
        bounds.append(f"mín {rule.min_value:g}")
    if rule.max_value is not None:
        bounds.append(f"máx {rule.max_value:g}")
    return f"{rule.name}: {value:g}{(' ' + unit) if unit else ''} ({', '.join(bounds)})"


def _alert(
    rule: AlertRule,
    *,
    station_id,
    subject_key: str,
    value: float,
    now: datetime,
    sensor: Sensor | None = None,
    unit: str = "",
) -> Alert:
    return Alert(
        rule_id=rule.id,
        station_id=station_id,
        sensor_id=sensor.id if sensor else None,
        subject_key=subject_key,
        kind=rule.kind,
        parameter=rule.parameter,
        severity=rule.severity,
        message=_describe(rule, value, unit),
        trigger_value=value,
        threshold_min=rule.min_value,
        threshold_max=rule.max_value,
        first_triggered_at=now,
        last_triggered_at=now,
    )


def evaluate_reading(rules: Iterable[AlertRule], sensor: Sensor, value: float, now: datetime) -> list[Alert]:
    return [
        _alert(
            rule,
            station_id=sensor.station_id,
            subject_key=f"sensor:{sensor.id}",
            value=value,
            now=now,
            sensor=sensor,
            unit=sensor.unit,
        )
        for rule in rules
        if rule.kind is RuleKind.READING_RANGE
        and rule.applies_to_station(sensor.station_id)
        and rule.parameter == sensor.type
        and (rule.location is None or rule.location == sensor.location)
        and _out_of_bounds(rule, value)
    ]


def evaluate_sensor_silence(rules: Iterable[AlertRule], sensor: Sensor, now: datetime) -> list[Alert]:
    if sensor.last_seen_at is None:
        return []  # nunca ha reportado: aún no instalado, no es una falla
    silent_min = (now - sensor.last_seen_at).total_seconds() / 60
    return [
        _alert(
            rule,
            station_id=sensor.station_id,
            subject_key=f"sensor:{sensor.id}",
            value=round(silent_min, 1),
            now=now,
            sensor=sensor,
            unit="min",
        )
        for rule in rules
        if rule.kind is RuleKind.SENSOR_OFFLINE
        and rule.applies_to_station(sensor.station_id)
        and (rule.parameter is None or rule.parameter == sensor.type)
        and _out_of_bounds(rule, silent_min)
    ]


def evaluate_cycle(rules: Iterable[AlertRule], cycle: CentrifugeCycle, now: datetime) -> list[Alert]:
    if cycle.vibration_mm_s is None:
        return []
    return [
        _alert(
            rule,
            station_id=cycle.station_id,
            subject_key=f"station:{cycle.station_id}",
            value=cycle.vibration_mm_s,
            now=now,
            unit="mm/s",
        )
        for rule in rules
        if rule.kind is RuleKind.CENTRIFUGE_VIBRATION
        and rule.applies_to_station(cycle.station_id)
        and _out_of_bounds(rule, cycle.vibration_mm_s)
    ]


def evaluate_treatment(rules: Iterable[AlertRule], batch: TreatmentBatch, now: datetime) -> list[Alert]:
    return [
        _alert(
            rule,
            station_id=batch.station_id,
            subject_key=f"station:{batch.station_id}",
            value=batch.efficiency_pct,
            now=now,
            unit="%",
        )
        for rule in rules
        if rule.kind is RuleKind.TREATMENT_EFFICIENCY
        and rule.applies_to_station(batch.station_id)
        and _out_of_bounds(rule, batch.efficiency_pct)
    ]
