# Fidelidad entre diseño, firmware, Wokwi, modelo 3D y dashboard

No hay prototipo físico: la boya existe como diseño (modelo 3D), firmware simulado en Wokwi y datos
en el dashboard. Para que la demo sea creíble, las tres partes cuentan la misma historia.

**Regla:** un dato de la boya solo aparece en el dashboard como *medido* si existe la pieza que lo
mide en el circuito de Wokwi (`firmware/boya-rm01/diagram.json`), en el firmware
(`firmware/boya-rm01/sketch.ino`) y en el modelo 3D
(`frontend/src/app/features/buoys/three/buoy-factory.ts`). Lo demás se etiqueta como lo que es:
*derivado*, *registrado por la cuadrilla*, *simulado* o *no disponible*.

**Alcance:** las boyas RM-01 y RM-02 (firmware, emulador `backend/scripts/buoy.py`, modelo 3D y panel
de telemetría). Las 3 estaciones del simulador del backend (`scripts/simulate.py`: ciclos de
centrífuga, RPM, vibración, lodo, oxígeno disuelto) son de un concepto anterior de planta de
tratamiento y **no** son datos de la boya; ver «Pendiente».

**Costo:** el diseño del modelo 3D estima **$5,384 MXN** (materiales $4,682 + 15 % de imprevistos,
precios de noviembre 2026). La lista de materiales (`hardware/bom.csv`) todavía no está en el repo:
súbanla antes de citar el número ante el jurado.

## 1. Matriz de trazabilidad

Claves del mensaje: `firmware/boya-rm01/sketch.ino` → `API.md` («Dispositivos — telemetría de la boya»).
El backend asigna los `sensor_id` (UUID); el firmware **no** manda IDs de sensor.

| Dato en el dashboard | Origen | Pieza | Conexión | En Wokwi | Clave del firmware | Backend |
|---|---|---|---|---|---|---|
| pH entrada | Medido | PH-4502C | ADS1115 #1 A0 | Potenciómetro | `ph` | lectura `ph/inlet` |
| pH salida | Medido (solo con flujo) | PH-4502C | ADS1115 #1 A1 | Potenciómetro | `ph_out` | lectura `ph/outlet` |
| TDS | Medido | TDS Meter V1.0 | ADS1115 #1 A2 | Potenciómetro | `tds_ppm` | lectura `tds/inlet` |
| Turbidez entrada | Medido | Turbidez genérico | ADS1115 #1 A3 | Potenciómetro | `turb_in_ntu` | lectura `turbidity/inlet` |
| Turbidez salida | Medido (solo con flujo) | Turbidez genérico | ADS1115 #2 A0 | Potenciómetro | `turb_out_ntu` | lectura `turbidity/outlet` |
| Temperatura | Medido | DS18B20 | GPIO5 | DS18B20 | `temp_c` | lectura `temperature/inlet` |
| Eficiencia del filtro | Derivado (firmware, solo con flujo) | turbidez entrada vs salida | — | — | `eficiencia_pct` | `device_efficiency_pct` |
| Caudal | Medido | YF-S401 | GPIO35 | Reloj 245 Hz + compuerta AND | `caudal_lpm` | `flow_rate_lpm` |
| Agua procesada | Derivado (firmware) | suma del caudal | — | — | `litros_total` | `water_liters_total` |
| Bomba: estado | Medido | MOSFET D4184 | GPIO27 | LED azul | `bomba` | `pump_on` |
| Bomba: ciclos | Derivado (firmware) | encendidos de la bomba | — | — | `ciclos_bomba` | `pump_cycles` |
| Bomba: corriente | Medido | ACS712 5 A | ADS1115 #2 A3 | Chip propio acs712 (0 A con la bomba apagada) | `bomba_a` | `pump_current_a` |
| Batería (V y %) | Medido | divisor 100k/33k | ADS1115 #2 A1 | Deslizador | `bat_v`, `bat_pct` | `battery_v`, `battery_pct` |
| Voltaje del generador | Medido | divisor 100k/10k | ADS1115 #2 A2 | Deslizador | `gen_v` | `generator_v` |
| Freno activo | Medido | MOSFET D4184 | GPIO14 | LED naranja | `freno` | `brake_on` |
| Alerta local | Derivado (firmware) | mismos umbrales que las reglas por defecto del backend + inclinación/golpe (ver § 3) | GPIO2 | LED rojo | `alerta` | `alarm_on` |
| Cesta: % de llenado | Medido | JSN-SR04T | TRIG GPIO15, ECHO GPIO34 | HC-SR04 | `cesta_pct` | `basket_fill_pct` |
| Basura (kg y tipo) | Registrado por la cuadrilla | báscula colgante | `POST /waste-collections` | — | — | `waste_collections` |
| Inclinación y golpes | Medido | MPU6050 | I2C 0x68 | MPU6050 | `inclinacion_deg`, `golpe` | `tilt_deg`, `shock` |
| Señal 4G | Medido | módem A7670SA (AT+CSQ) | UART2 RX16 TX17, PWRKEY 4 | Chip propio a7670sa | `senal_csq` | `signal_csq`, `rssi_dbm` |

## 2. Modelo 3D = Wokwi = web

- Las piezas de **medición y control** del modelo 3D (v8) son las del circuito de Wokwi, con los
  mismos umbrales del firmware: bomba 35 % / 75 %, freno 26 / 22 V y 12.5 / 12.3 V, batería
  9.0–12.6 V, cesta 44–30 cm. La etapa de potencia (XL4015, BMS, LM2596, diodos, fusible, resistencia
  de freno) solo existe en el 3D: en Wokwi la batería y el generador son deslizadores y el freno un LED.
- **Estado inicial igual:** `diagram.json` arranca con los valores del estado inicial del modelo
  (tabla en `firmware/boya-rm01/README.md`).
- **El 3D enseña el último paquete del ESP32** (`aplicarTelemetria`): batería, bomba, freno,
  generador, cesta, inclinación, litros y el color del agua según la turbidez medida. Su estado nunca
  avanza solo (`congelado`); sin datos enseña el estado inicial del diseño. Una etiqueta sobre la
  escena dice el origen: «EN VIVO · Wokwi», «Último dato de Wokwi · hace X» o «Sin datos · estado
  inicial del diseño». Solo se animan el agua, el molino y los peces.
- **Boyas de la web = boyas del backend = firmware:** RM-01 y RM-02, con las coordenadas de
  `backend/scripts/seed.py`. Su estado en la web sale de la telemetría («En vivo · Wokwi», «Saturada»,
  «Sin señal», «Sin datos»), no de un estado de despliegue; el origen dice «Simulada en Wokwi».
- Un paquete cuenta como «en vivo» durante 2.5 veces el ritmo real con el que llegan (mínimo 45 s,
  máximo 5 min): Wokwi suele correr más lento que el tiempo real y los envíos de «cada 15 s» llegan
  cada 1–2 min. El firmware resincroniza el reloj en cada envío para que la hora no se atrase.
- Lo que solo existe en la simulación 3D (RPM del molino, potencia en W, tensión de las líneas de
  anclaje) **no** se muestra como dato medido.
- **Baliza y LED de envío:** la baliza roja sobre el domo es el LED de alerta (GPIO2) y sigue la clave
  `alerta` del paquete (`alarm_on`); el LED de la punta de la antena es el LED verde de envío (GPIO25)
  y cada paquete nuevo lo enciende con unas ondas. Sin paquete el LED de envío queda apagado (igual
  que el firmware antes del primer envío o cuando falla) y la baliza aplica la regla del firmware al
  estado inicial del diseño, que ya enciende la alerta (turbidez de salida ≈ 22 > 5 NTU, como en Wokwi). Sin paquete ni `congelado` (artefacto suelto) el modelo simula los
  envíos cada 5 min y el guardado sin señal con las mismas reglas que `sketch.ino`.
- **Manguera y tanque en la orilla:** el agua que sale del caudalímetro va por una manguera lastrada por
  el fondo hasta un tinaco de ≈1,100 L en la orilla. Son piezas mecánicas sin sensor: el nivel del
  tinaco es *derivado* de los litros del caudalímetro (`litros_total`), no medido. No entran en el
  costo de $5,384 mientras no esté `hardware/bom.csv`. `API.md` todavía describe `wqi_outlet` como
  «agua que regresa al río».

## 3. Valores creíbles

- **pH:** entrada y salida casi iguales. La calcita solo sube el pH del agua **ácida** hacia 7; no baja
  el agua alcalina.
- **TDS:** pasa casi completo por el filtro. Se satura en 1,000 ppm (rango del TDS Meter V1.0).
- **Turbidez:** baja 60–90 % con el filtro limpio y la mejora se reduce conforme se tapa.
- **Sin flujo no hay dato de salida:** con la bomba apagada (caudal < 0.1 L/min) las sondas de salida
  están en agua estancada; el firmware, el emulador y el 3D no reportan pH ni turbidez de salida ni
  eficiencia.
- **Alerta:** el LED de la boya (`alerta`) usa los umbrales de las reglas por defecto del backend
  (`backend/app/domain/defaults.py`): pH de entrada o salida fuera de 6.5–8.5, turbidez de entrada
  > 100 NTU, de salida > 5 NTU, temperatura fuera de 10–30 °C; más inclinación > 30° o golpe, que el
  backend no evalúa. La regla de TDS (> 1000 ppm) no aplica a la boya: el sensor se satura en 1000.
- **Caudal:** ≈ 2.5 L/min solo con la bomba prendida; 0 con la bomba apagada.
- **Energía:** el molino da 0 W abajo de ~0.35 m/s y ≈ 4.6 W a 0.9 m/s; la boya gasta ≈ 1 W y la bomba ≈ 5 W.
- **Datos:** con huecos (sin señal), ruido y desviación entre calibraciones. Si un sensor no responde,
  su clave no se manda y el dashboard muestra «sin dato», nunca 0.

## 4. Lo que la boya no mide (no debe aparecer como dato de la boya)

Oxígeno disuelto, ORP, conductividad, metales pesados, DBO/DQO, coliformes, colorantes, nutrientes,
RPM o vibración de un motor, lodo y kilos de basura en el agua. Las boyas del seed no tienen sensor de
oxígeno disuelto.

## 5. Regla para cada cambio

Si se agrega, quita o cambia una pieza, una clave o un umbral, en el mismo cambio se actualizan:

1. `firmware/boya-rm01/diagram.json` y la tabla de conexiones al inicio de `sketch.ino`.
2. `frontend/src/app/features/buoys/three/buoy-factory.ts` (piezas, `BOYA_CFG`, `SENSORES_BOYA`).
3. `backend/scripts/buoy.py` (emulador) y, si es una clave nueva, `telemetry_payload.py` + `API.md`.
4. Esta matriz y las etiquetas del dashboard.
5. `hardware/bom.csv` y el costo, cuando exista en el repo.

## Pendiente (decisión del equipo)

- El módulo de **centrífuga** del dashboard y del backend (ciclos, RPM, vibración, lodo) y las
  estaciones del simulador con oxígeno disuelto vienen del concepto anterior. Si se quedan, deben
  presentarse como «estación de tratamiento (concepto, simulada)», no como datos de la boya.
- Subir `hardware/bom.csv`.
- Las 3 estaciones simuladas del seed se describen como «Boya prototipo en…» aunque son del concepto
  anterior (centrífuga, oxígeno disuelto).
- Límites de Wokwi que no se pueden cerrar en el circuito: los potenciómetros dan 0–5 V (solo
  0–675 equivale a 0–3.3 V reales), los de salida son independientes (se pueden poner valores que la
  calcita no daría), la batería puede pasar de 12.6 V y el voltaje del generador no baja al frenar.
