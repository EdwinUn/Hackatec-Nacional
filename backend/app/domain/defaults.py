"""Reglas de alerta por defecto. Se siembran en la tabla alert_rules y se editan por API.

⚠️ TODOS son VALORES DE PROTOTIPO / CONFIGURABLES. Las referencias indican de dónde se tomó
la idea del umbral, no que el umbral esté validado para los ríos de Puebla. Antes de usar en
campo, revisar con la norma vigente (p. ej. NOM-001-SEMARNAT-2021 para descargas,
NOM-127-SSA1-2021 para agua de uso y consumo humano) y con especialistas.
"""

from app.domain.entities import AlertRule
from app.domain.enums import RuleKind, SensorLocation, SensorType, Severity


def default_alert_rules() -> list[AlertRule]:
    r = RuleKind.READING_RANGE
    return [
        AlertRule(
            name="pH fuera del rango aceptable",
            kind=r,
            severity=Severity.WARNING,
            parameter=SensorType.PH,
            min_value=6.5,
            max_value=8.5,
            description="Prototipo. 6.5–8.5 es el rango aceptable usado por guías de agua "
            "(p. ej. NOM-127-SSA1, guías secundarias de la EPA).",
        ),
        AlertRule(
            name="pH extremo",
            kind=r,
            severity=Severity.CRITICAL,
            parameter=SensorType.PH,
            min_value=5.5,
            max_value=9.5,
            description="Prototipo. Margen de ±1 unidad fuera del rango aceptable; indica "
            "una posible descarga ácida/alcalina.",
        ),
        AlertRule(
            name="Turbidez alta en el río/entrada",
            kind=r,
            severity=Severity.WARNING,
            parameter=SensorType.TURBIDITY,
            location=SensorLocation.INLET,
            max_value=100,
            description="Prototipo. El agua superficial varía mucho; 100 NTU marca un pico "
            "de sedimentos/contaminación respecto a la línea base esperada.",
        ),
        AlertRule(
            name="Turbidez alta a la salida",
            kind=r,
            severity=Severity.WARNING,
            parameter=SensorType.TURBIDITY,
            location=SensorLocation.OUTLET,
            max_value=5,
            description="Prototipo. Meta de salida inspirada en el orden de magnitud de "
            "normas de agua de consumo (~4–5 NTU); el filtro no está cumpliendo.",
        ),
        AlertRule(
            name="Oxígeno disuelto bajo",
            kind=r,
            severity=Severity.WARNING,
            parameter=SensorType.DISSOLVED_OXYGEN,
            min_value=5,
            description="Prototipo. Por debajo de ~5 mg/L muchas especies acuáticas "
            "presentan estrés (criterio común en guías de vida acuática).",
        ),
        AlertRule(
            name="Hipoxia",
            kind=r,
            severity=Severity.CRITICAL,
            parameter=SensorType.DISSOLVED_OXYGEN,
            min_value=2,
            description="Prototipo. < 2 mg/L es la definición usual de hipoxia.",
        ),
        AlertRule(
            name="Temperatura anómala",
            kind=r,
            severity=Severity.INFO,
            parameter=SensorType.TEMPERATURE,
            min_value=10,
            max_value=30,
            description="Prototipo. Rango plausible para ríos del altiplano poblano; "
            "ajustar con datos históricos.",
        ),
        AlertRule(
            name="Conductividad alta",
            kind=r,
            severity=Severity.WARNING,
            parameter=SensorType.CONDUCTIVITY,
            max_value=1500,
            description="Prototipo. Valores altos sugieren sales/descargas; ajustar a la "
            "línea base de cada río.",
        ),
        AlertRule(
            name="Sólidos disueltos totales altos",
            kind=r,
            severity=Severity.WARNING,
            parameter=SensorType.TDS,
            max_value=1000,
            description="Prototipo. Orden de magnitud del límite de SDT en normas de agua "
            "de consumo (~1000 mg/L).",
        ),
        AlertRule(
            name="Sensor sin señal",
            kind=RuleKind.SENSOR_OFFLINE,
            severity=Severity.WARNING,
            max_value=10,
            description="Prototipo. Minutos sin reportar antes de considerar el sensor caído.",
        ),
        AlertRule(
            name="Vibración elevada en centrífuga",
            kind=RuleKind.CENTRIFUGE_VIBRATION,
            severity=Severity.WARNING,
            max_value=4.5,
            description="Prototipo. Inspirado en zonas de severidad de vibración (mm/s RMS) "
            "de ISO 10816 para máquinas pequeñas; calibrar con el equipo real.",
        ),
        AlertRule(
            name="Vibración peligrosa en centrífuga",
            kind=RuleKind.CENTRIFUGE_VIBRATION,
            severity=Severity.CRITICAL,
            max_value=7.1,
            description="Prototipo. Zona de daño posible según la misma escala; detener y revisar balanceo.",
        ),
        AlertRule(
            name="Eficiencia de recuperación baja",
            kind=RuleKind.TREATMENT_EFFICIENCY,
            severity=Severity.WARNING,
            min_value=70,
            description="Prototipo. Menos de 70% del agua regresa limpia: revisar filtros.",
        ),
    ]
