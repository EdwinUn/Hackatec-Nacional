# Firmware de las boyas RM-01 y RM-02 (Wokwi)

No hay boya física: las dos boyas existen solo como simulación. Este firmware corre en Wokwi y el
backend lo recibe por MQTT como si fuera la boya real.

| Archivo | Qué es |
| --- | --- |
| `sketch.ino` | Firmware del ESP32. Mismo archivo para las dos boyas: solo cambia `BOYA` |
| `diagram.json` | Circuito de Wokwi (2 ADS1115, MPU6050, DS18B20, sonar, caudalímetro, microSD, módem) |
| `libraries.txt` | Librerías Arduino del sketch |
| `ads1115.chip.json` / `.chip.c` | Chip propio: convertidor ADS1115 (Wokwi no lo trae) |
| `a7670sa.chip.json` / `.chip.c` | Chip propio: módem 4G A7670SA; contesta comandos AT y decide si hay red |
| `acs712.chip.json` / `.chip.c` | Chip propio: sensor de corriente ACS712 en serie con la bomba (0 A con la bomba apagada) |

## Cargarlo en wokwi.com

1. Abre (o crea) un proyecto ESP32 por boya.
2. Pega `sketch.ino`, `diagram.json` y `libraries.txt`.
3. Crea los seis archivos de los chips con la flecha ▾ junto a las pestañas → *New file…*, con el
   mismo nombre. Wokwi los compila solo; el tipo `chip-ads1115` del diagrama depende de que el chip
   se llame `ads1115` (igual con `a7670sa` y `acs712`).
4. Para la boya 2 cambia una línea del sketch: `const char *BOYA = "RM-02";`.
5. En `backend/.env`: `MQTT_URL=mqtt://broker.hivemq.com:1883` (el mismo broker del sketch).

Wokwi en línea solo da WiFi a una simulación a la vez. Para tener las dos boyas en vivo, una corre en
Wokwi y la otra con el emulador del backend, que publica las mismas claves:
`uv run python -m scripts.buoy --code RM-02 --scenario limpia` (desde `backend/`).

## Mismo estado que el modelo 3D

Los valores iniciales de `diagram.json` reproducen el estado inicial del modelo 3D de la app
(`frontend/src/app/features/buoys/three/buoy-factory.ts`). Se calcularon con las fórmulas del sketch
y con la escala de Wokwi: **sus potenciómetros dan 0–5 V** aunque estén conectados a 3V3 («the
reference voltage for all the virtual ADCs is 5 volts», docs.wokwi.com/chips-api/analog). Por eso
valor = voltaje ÷ 5 × 1023, y un potenciómetro solo representa algo real entre **0 y 675** (0–3.3 V):

| Dato | Modelo 3D | Pieza en Wokwi | Valor |
| --- | --- | --- | --- |
| pH entrada / salida | 6.70 / 6.80 | `pot_ph_in` / `pot_ph_out` | 352 / 347 |
| TDS | ≈ 690 ppm | `pot_tds` (con 19.4 °C) | 310 |
| Temperatura | 19.4 °C | `temp1` | 19.4 |
| Turbidez entrada / salida | 82 / 22 NTU | `pot_tin` / `pot_tout` | 620 / 660 |
| Batería | 80 % → bomba prendida | `sl_bat` | 603 |
| Generador | ≈ 14 V (río a 0.9 m/s) | `sl_gen` | 259 |
| Corriente de la bomba | 0.4 A (solo con la bomba prendida) | `acs1` (chip acs712) | corriente 0.4 |
| Caudal | 2.5 L/min | `clock1` | 245 Hz |
| Inclinación | ≈ 2.3° | `mpu1` | accelX 0.04 g |
| Cesta | vacía | `sonar1` | 44 cm |
| Señal del módem | CSQ 22 | `modem1` | senal 22 |

En la app, el modelo 3D enseña el último paquete de este firmware (batería, bomba, freno, generador,
cesta, inclinación, agua procesada y el color del agua según la turbidez medida). Si mueves un control
en Wokwi, el modelo cambia. Su estado nunca avanza solo: sin datos enseña el estado inicial del diseño,
y una etiqueta sobre la escena dice si es «EN VIVO · Wokwi», el último dato o el estado de diseño.

## Reglas del circuito que el modelo 3D también sigue

- **Sondas de salida solo con flujo.** Si el caudalímetro marca menos de 0.1 L/min (bomba apagada o
  recién encendida), `ph_out`, `turb_out_ntu` y `eficiencia_pct` no se mandan: las sondas están en
  agua estancada, no en agua filtrada.
- **Corriente de la bomba.** El chip `acs712` está en serie con la bomba: su pin IP va a GPIO27 (la
  salida de la bomba) y, con la bomba apagada, da 2.5 V = 0 A, como el sensor real. Su control fija
  lo que consume la bomba cuando está prendida. Es lo mismo que el reloj del caudalímetro, que pasa
  por la compuerta AND.

Valores útiles del deslizador de batería: 521 = 35 % (la bomba se apaga), 594 = 75 % (vuelve a
prender), 640 = 12.6 V (batería llena). Del generador: 484 = 26 V (se activa el freno).
- **Alerta (`alerta`, LED rojo).** Usa los mismos umbrales que las reglas por defecto del backend:
  pH de entrada o salida fuera de 6.5–8.5, turbidez de entrada > 100 NTU, de salida > 5 NTU y
  temperatura fuera de 10–30 °C. Además, inclinación > 30° o golpe (alarma del dispositivo, que el
  backend no convierte en alerta). La regla de TDS del backend (> 1000 ppm) no aplica: el sensor se
  satura en 1000 ppm.

## Límites de la simulación (no son datos reales)

- Los potenciómetros son independientes: el pH de salida puede ponerse en un valor que la calcita no
  daría (p. ej. más bajo que el de entrada con agua alcalina). Para la demo, muévelos de forma
  coherente con `docs/fidelidad.md` § 3.
- Los potenciómetros y deslizadores llegan a 5 V; arriba de 675 (3.3 V) es un estado imposible en
  la boya real. El ADS1115 se satura en 4.096 V: con la batería al tope, Wokwi reporta 16.5 V.
- La batería 3S no pasa de 12.6 V (deslizador en 640).
- El voltaje del generador no baja cuando el freno se activa (en el modelo 3D baja a 0.75).
- Wokwi corre más lento que el tiempo real (mira el % junto al reloj de la simulación): los envíos
  de «cada 15 s» llegan cada 1–2 min. La web mide «en vivo» por ese ritmo y el firmware resincroniza
  el reloj en cada envío. Los chips propios solo trabajan cuando hace falta (sin temporizadores
  rápidos) para no frenar más la simulación. Deja la pestaña de Wokwi visible: oculta, se pausa.

## Mensaje

Un JSON plano por envío en `riomonitor/<BOYA>/telemetria`. Si un sensor no responde, su clave no
se manda (no se inventa un 0). Contrato completo: `API.md` → «Dispositivos — telemetría de la boya».

`boya`, `n`, `ts`, `ph` (entrada), `ph_out`, `tds_ppm`, `temp_c`, `turb_in_ntu`, `turb_out_ntu`,
`eficiencia_pct`, `bat_v`, `bat_pct`, `gen_v`, `freno`, `bomba`, `alerta`, `caudal_lpm`, `litros_total`,
`cesta_pct`, `bomba_a`, `ciclos_bomba`, `inclinacion_deg`, `golpe`, `senal_csq`.

`ENVIAR_CAMPOS_NUEVOS 0` deja solo las claves anteriores a `ph_out`.

## Qué no cambiar sin actualizar lo demás

Pines, calibración y umbrales (bomba 35 % / 75 %, freno 26 / 22 V y 12.5 / 12.3 V) son los mismos del
modelo 3D y del emulador del backend. Si cambia una pieza o un umbral, se actualiza en el mismo cambio
todo lo que lista `docs/fidelidad.md`.

`MODO_SIMULACION 0` (módem 4G real con TinyGSM) se conserva como referencia de cómo funcionaría con
hardware, pero no se ha probado: el proyecto es 100 % digital.
