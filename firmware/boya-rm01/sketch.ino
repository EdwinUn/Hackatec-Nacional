/*
  Río Monitor · Boya 1 (RM-01, colector Panzacola) · firmware ESP32
  Misma electrónica que el modelo 3D y que la boya 2 en Wokwi (ADS1115, módem A7670SA, etc.).

  Publica la telemetría por MQTT; el backend FastAPI está suscrito al mismo broker:
      tópico  riomonitor/RM-01/telemetria          (RM-01 = `code` de la estación en el backend)
      mensaje {"boya":"RM-01","n":1,"ts":"…","ph":…,"tds_ppm":…, …}
  Las claves de siempre no cambian (ph, tds_ppm, temp_c, turb_in_ntu, turb_out_ntu, eficiencia_pct,
  bat_v, bat_pct, gen_v, freno, bomba, alerta). Las de los sensores nuevos se agregan al final
  (ver ENVIAR_CAMPOS_NUEVOS). Si un sensor no responde, su clave no se envía: no se inventa el dato.

  libraries.txt de Wokwi: OneWire, DallasTemperature, PubSubClient, Adafruit ADS1X15, Adafruit BusIO
  Archivos del proyecto Wokwi: diagram.json, ads1115.chip.json/.c, a7670sa.chip.json/.c (los mismos de la boya 2)

  Pieza real                          En Wokwi                       Conexión
  ---------------------------------   ----------------------------   ----------------------
  ADS1115 #1 (0x48)                   Chip propio ads1115            I2C SDA21 SCL22
    A0 pH entrada (PH-4502C)          Potenciómetro
    A1 pH salida  (PH-4502C)          Potenciómetro
    A2 TDS                            Potenciómetro
    A3 Turbidez entrada               Potenciómetro
  ADS1115 #2 (0x49)                   Chip propio ads1115            I2C SDA21 SCL22
    A0 Turbidez salida                Potenciómetro
    A1 Batería (divisor 100k/33k)     Deslizador
    A2 Generador (divisor 100k/10k)   Deslizador
    A3 Corriente bomba (ACS712 5 A)   Potenciómetro
  MPU6050 (0x68) inclinación/golpes   MPU6050                        I2C SDA21 SCL22
  DS18B20 temperatura                 DS18B20                        GPIO5
  JSN-SR04T nivel de la cesta         HC-SR04                        TRIG GPIO15, ECHO GPIO34
  YF-S401 caudalímetro (salida)       Reloj 245 Hz + compuerta AND   GPIO35
                                      (solo pulsa con la bomba prendida)
  microSD                             microSD                        CS13 SCK18 MISO19 MOSI23
  Alimentación pH entrada / salida    LED                            GPIO32 / GPIO33
  Alimentación TDS                    LED                            GPIO26
  MOSFET bomba                        LED azul                       GPIO27
  MOSFET freno (resist. descarga)     LED naranja                    GPIO14
  Alerta / envío correcto             LED rojo / verde               GPIO2 / GPIO25
  Módem 4G A7670SA + SIM              Chip propio a7670sa            RX16 TX17 PWRKEY4

  Conexión a internet:
  - MODO_SIMULACION 1: el chip a7670sa contesta los comandos AT y decide si hay SIM y red
    (controles del chip); si hay red, los bytes salen por el WiFi "Wokwi-GUEST".
  - MODO_SIMULACION 0: todo va por el módem 4G con la SIM (TinyGSM).
  Sin red, los mensajes se guardan y se publican en orden al reconectar, cada uno con su hora.
*/

#define MODO_SIMULACION      1   // 1 = Wokwi (WiFi), 0 = boya real (módem 4G)
#define USAR_BLE             0   // 1 = lecturas por Bluetooth en campo (Wokwi no simula BLE)
#define ENVIAR_CAMPOS_NUEVOS 1   // 0 = solo las claves de siempre (si el backend rechaza claves extra)

#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <SPI.h>
#include <SD.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>
#include <PubSubClient.h>

HardwareSerial SerialModem(2);   // UART2 al A7670SA, en los dos modos

#if MODO_SIMULACION
  #include <WiFi.h>
  WiFiClient red;
#else
  #define TINY_GSM_MODEM_SIM7600   // el A7670SA usa los mismos comandos AT
  #include <TinyGsmClient.h>
  TinyGsm modem(SerialModem);
  TinyGsmClient red(modem);
  const char APN[]      = "internet.itelcel.com";  // Telcel; cámbialo según tu SIM
  const char APN_USER[] = "webgprs";
  const char APN_PASS[] = "webgprs2002";
#endif

#if USAR_BLE
  #include <NimBLEDevice.h>
  NimBLECharacteristic *bleLecturas = nullptr;
  const char *BLE_SERVICIO = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const char *BLE_LECTURAS = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
#endif

// ---------- Backend (vía broker MQTT) ----------
// Broker público: sirve para la demo, pero cualquiera puede publicar en el tópico.
// Para la boya real usa un broker propio con usuario y contraseña.
const char *MQTT_HOST    = "broker.hivemq.com";
const int   MQTT_PUERTO  = 1883;
const char *MQTT_USUARIO = nullptr;   // nullptr = sin autenticación
const char *MQTT_CLAVE   = nullptr;
// `code` de la estación en el backend: RM-01 (colector Panzacola) o RM-02 (estación testigo).
// Este mismo sketch sirve para la boya 2: solo cambia esta línea.
const char *BOYA = "RM-01";
String topico = String("riomonitor/") + BOYA + "/telemetria";

PubSubClient mqtt(red);

// ---------- Pines ----------
const int PIN_SDA = 21, PIN_SCL = 22;
const int PIN_ONEWIRE = 5, PIN_SD_CS = 13;
const int PIN_PH_IN_PWR = 32, PIN_PH_OUT_PWR = 33, PIN_TDS_PWR = 26;
const int PIN_BOMBA = 27, PIN_FRENO = 14, PIN_ALERTA = 2, PIN_ENVIO = 25;
const int PIN_TRIG = 15, PIN_ECHO = 34, PIN_FLUJO = 35;
const int PIN_MODEM_RX = 16, PIN_MODEM_TX = 17, PIN_MODEM_PWR = 4;

// ---------- Calibración (ver plan de mantenimiento) ----------
const float PH_IN_V7  = 1.65, PH_IN_PEND  = 0.2357;   // V a pH 7 y V por unidad de pH
const float PH_OUT_V7 = 1.65, PH_OUT_PEND = 0.2357;
const float VREF_TURB = 3.3;
const float DIVISOR_BAT = 4.03;                        // (100k + 33k) / 33k
const float DIVISOR_GEN = 11.0;                        // (100k + 10k) / 10k -> 3.3 V = 36 V
const float BAT_VACIA = 9.0, BAT_LLENA = 12.6;         // 3S2P Li-ion: 3.0 V y 4.2 V por celda
const float ACS_CERO_V = 2.50, ACS_V_POR_A = 0.185;     // ACS712 5 A
const float PULSOS_POR_LITRO = 98.0 * 60.0;             // YF-S401: F(Hz) = 98 × Q(L/min)
const float CESTA_DIST_VACIA = 44.0, CESTA_DIST_LLENA = 30.0;   // cm (sensor 30 cm sobre la tapa)

// ---------- Protección contra sobrecarga y ciclo de la bomba ----------
// El cargador CC/CV ya limita la batería a 12.6 V. El riesgo es el generador:
// si la batería se llena o el río corre muy rápido, el molino se acelera y su
// voltaje sube. La resistencia de descarga (en paralelo al generador) lo frena.
const float GEN_V_FRENAR = 26.0, GEN_V_SOLTAR = 22.0;
const float BAT_V_LLENA_FRENO = 12.5, BAT_V_SOLTAR = 12.3;
const float BAT_PARAR = 35.0, BAT_ARRANCAR = 75.0;

// ---------- Alertas locales (el backend evalúa las suyas) ----------
const float PH_MIN = 6.5, PH_MAX = 8.5, TDS_MAX = 500.0, TURB_MAX = 50.0;
const float INCLINACION_MAX = 30.0;    // grados: boya volcada o jalada por la corriente
const float GOLPE_G = 0.5;             // desviación de 1 g que cuenta como golpe

// ---------- Tiempos ----------
#if MODO_SIMULACION
const unsigned long PERIODO_LECTURA_MS = 3000, PERIODO_ENVIO_MS = 15000;    // demo: cada 15 s
#else
const unsigned long PERIODO_LECTURA_MS = 30000, PERIODO_ENVIO_MS = 300000;  // cada 5 min
#endif

// ---------- Buffer de envíos pendientes ----------
// ts = 0 significa "sin hora": el backend usa la hora de llegada.
struct Envio {
  uint32_t n, ciclos;
  time_t ts;
  float ph, phOut, tds, temp, turbIn, turbOut, batV, batPct, genV;
  float caudal, litros, cesta, bombaA, inclinacion;
  int8_t csq;
  bool freno, bomba, alerta, golpe;
};
const int MAX_PENDIENTES = 120;        // ≈ 10 h sin señal con envíos cada 5 min
Envio pendientes[MAX_PENDIENTES];
int numPendientes = 0;

Adafruit_ADS1115 ads1, ads2;
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature termometro(&oneWire);
bool ads1Ok = false, ads2Ok = false, mpuOk = false, sdLista = false, relojListo = false;
bool bombaEncendida = false, frenoActivo = false;
unsigned long ultimaLectura = 0, ultimoEnvio = 0;
uint32_t ciclosBomba = 0, numEnvio = 0;
float litrosAcumulados = 0;
volatile uint32_t pulsosFlujo = 0;
Envio ultimo;
struct EstadoModem { bool encendido, sim, red; int csq; String operador; } em = { false, false, false, 99, "" };

void IRAM_ATTR alPulsoFlujo() { pulsosFlujo++; }

// ================= Lecturas =================
float voltsADS(Adafruit_ADS1115 &ads, bool ok, int canal) {
  if (!ok) return NAN;
  float suma = 0;
  for (int i = 0; i < 4; i++) suma += ads.computeVolts(ads.readADC_SingleEnded(canal));
  return suma / 4.0;
}

// Los dos electrodos de pH y el TDS están en agua conectada: se encienden por turnos.
void alimentarSolo(int pin) {
  digitalWrite(PIN_PH_IN_PWR, pin == PIN_PH_IN_PWR);
  digitalWrite(PIN_PH_OUT_PWR, pin == PIN_PH_OUT_PWR);
  digitalWrite(PIN_TDS_PWR, pin == PIN_TDS_PWR);
  delay(250);
}

float aPH(float v, float v7, float pend) {
  if (isnan(v)) return NAN;
  return constrain(7.0f + (v7 - v) / pend, 0.0f, 14.0f);
}

float aTDS(float v, float tempC) {
  if (isnan(v)) return NAN;
  float vc = v / (1.0f + 0.02f * (tempC - 25.0f));
  return max(0.0f, (133.42f * vc * vc * vc - 255.86f * vc * vc + 857.39f * vc) * 0.5f);
}

float aTurbidez(float v) {
  if (isnan(v)) return NAN;
  return constrain((1.0f - v / VREF_TURB) * 1000.0f, 0.0f, 1000.0f);
}

float porcentajeBateria(float volts) {
  if (isnan(volts)) return NAN;
  return constrain((volts - BAT_VACIA) / (BAT_LLENA - BAT_VACIA) * 100.0f, 0.0f, 100.0f);
}

// Cuánta turbidez quitan los filtros (0–100 %).
float eficiencia(float turbIn, float turbOut) {
  if (isnan(turbIn) || isnan(turbOut)) return NAN;
  if (turbIn <= 0) return 0;
  return constrain((turbIn - turbOut) / turbIn * 100.0f, 0.0f, 100.0f);
}

float leerCestaPct() {
  digitalWrite(PIN_TRIG, LOW);  delayMicroseconds(4);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(20);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000);
  if (us == 0) return NAN;
  float cm = us * 0.0343f / 2.0f;
  return constrain((CESTA_DIST_VACIA - cm) / (CESTA_DIST_VACIA - CESTA_DIST_LLENA) * 100.0f, 0.0f, 100.0f);
}

void iniciarMPU() {
  Wire.beginTransmission(0x68);
  Wire.write(0x6B); Wire.write(0x00);          // salir de reposo
  mpuOk = Wire.endTransmission() == 0;
}

bool leerMPU(float &inclinacion, float &g) {
  if (!mpuOk) return false;
  Wire.beginTransmission(0x68);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(0x68, 6) != 6) return false;
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  float x = ax / 16384.0f, y = ay / 16384.0f, z = az / 16384.0f;
  g = sqrtf(x * x + y * y + z * z);
  inclinacion = g > 0.1f ? acosf(constrain(z / g, -1.0f, 1.0f)) * 180.0f / PI : 0.0f;
  return true;
}

void controlarFreno(float genV, float batV) {
  bool sobreVoltaje = genV > GEN_V_FRENAR;
  bool bateriaLlena = batV >= BAT_V_LLENA_FRENO && genV > batV;
  if (!frenoActivo && (sobreVoltaje || bateriaLlena)) frenoActivo = true;
  if (frenoActivo && genV < GEN_V_SOLTAR && batV < BAT_V_SOLTAR) frenoActivo = false;
  digitalWrite(PIN_FRENO, frenoActivo ? HIGH : LOW);
}

void controlarBomba(float bateriaPct) {
  bool antes = bombaEncendida;
  if (bombaEncendida && bateriaPct < BAT_PARAR) bombaEncendida = false;
  if (!bombaEncendida && bateriaPct > BAT_ARRANCAR) bombaEncendida = true;
  if (bombaEncendida && !antes) ciclosBomba++;
  digitalWrite(PIN_BOMBA, bombaEncendida ? HIGH : LOW);
}

// ================= Reloj =================
// Sin hora también se publica: el backend usa la hora de llegada.
void sincronizarReloj() {
#if MODO_SIMULACION
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  for (int i = 0; i < 40 && time(nullptr) < 1700000000; i++) delay(250);
#else
  int y, mo, d, h, mi, s; float tz;
  if (modem.getNetworkTime(&y, &mo, &d, &h, &mi, &s, &tz)) {
    struct tm t = {};
    t.tm_year = y - 1900; t.tm_mon = mo - 1; t.tm_mday = d; t.tm_hour = h; t.tm_min = mi; t.tm_sec = s;
    setenv("TZ", "UTC0", 1); tzset();
    struct timeval tv = { (time_t)(mktime(&t) - (time_t)(tz * 3600)), 0 };
    settimeofday(&tv, nullptr);
  }
#endif
  relojListo = time(nullptr) > 1700000000;
  Serial.println(relojListo ? "Reloj sincronizado (UTC)" : "Reloj sin sincronizar: el backend usará la hora de llegada");
}

String isoUTC(time_t ts) {
  struct tm t; gmtime_r(&ts, &t);
  char buf[25]; strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

// ================= Módem A7670SA =================
String atComando(const char *cmd, unsigned long ms = 1500) {
  while (SerialModem.available()) SerialModem.read();
  SerialModem.print(cmd); SerialModem.print("\r");
  String r; unsigned long t0 = millis();
  while (millis() - t0 < ms) {
    while (SerialModem.available()) r += (char)SerialModem.read();
    if (r.indexOf("OK\r\n") >= 0 || r.indexOf("ERROR") >= 0) break;
    delay(5);
  }
  return r;
}

void iniciarModem() {
  pinMode(PIN_MODEM_PWR, OUTPUT);
  digitalWrite(PIN_MODEM_PWR, HIGH); delay(100);
  digitalWrite(PIN_MODEM_PWR, LOW);  delay(1000);    // pulso de encendido
  digitalWrite(PIN_MODEM_PWR, HIGH);
  SerialModem.begin(115200, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
#if MODO_SIMULACION
  String r; unsigned long t0 = millis();
  while (millis() - t0 < 6000 && r.indexOf("RDY") < 0) {
    while (SerialModem.available()) r += (char)SerialModem.read();
    delay(10);
  }
  em.encendido = atComando("ATE0").indexOf("OK") >= 0;
  Serial.println(em.encendido ? "Módem A7670SA encendido" : "El módem no responde");
#else
  delay(3000);
  em.encendido = modem.restart();
  Serial.print("Módem: ");
  Serial.println(modem.getModemInfo());
#endif
}

void consultarModem() {
#if MODO_SIMULACION
  if (!em.encendido) { em.sim = em.red = false; return; }
  em.sim = atComando("AT+CPIN?").indexOf("READY") >= 0;
  String r = atComando("AT+CSQ");
  int i = r.indexOf("+CSQ: ");
  em.csq = i >= 0 ? r.substring(i + 6).toInt() : 99;
  r = atComando("AT+CEREG?");
  i = r.indexOf("+CEREG: ");
  int stat = i >= 0 ? r.substring(r.indexOf(',', i) + 1).toInt() : 0;
  em.red = em.sim && (stat == 1 || stat == 5);
  r = atComando("AT+COPS?");
  i = r.indexOf('"');
  em.operador = i >= 0 ? r.substring(i + 1, r.indexOf('"', i + 1)) : "";
#else
  em.sim = modem.getSimStatus() == 1;      // SIM_READY
  em.csq = modem.getSignalQuality();
  em.red = modem.isNetworkConnected();
  em.operador = em.red ? modem.getOperator() : "";
#endif
  Serial.printf("Módem: SIM %s · señal %d/31 · %s\n", em.sim ? "lista" : "NO", em.csq == 99 ? 0 : em.csq,
                em.red ? ("red " + em.operador).c_str() : "sin red");
}

// ================= Conexión =================
#if MODO_SIMULACION
unsigned long wifiInicioMs = 0;
#endif

bool conectarRed() {
#if MODO_SIMULACION
  if (WiFi.status() == WL_CONNECTED) return true;
  // WiFi.begin reinicia la asociación: se llama una vez y solo se repite tras 60 s sin conectar.
  if (wifiInicioMs == 0 || millis() - wifiInicioMs > 60000) {
    WiFi.disconnect();
    WiFi.mode(WIFI_STA);
    WiFi.begin("Wokwi-GUEST", "", 6);
    wifiInicioMs = millis();
  }
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("WiFi sin conexión (estado %d)\n", WiFi.status());
  return false;
#else
  if (modem.isGprsConnected()) return true;
  if (!modem.waitForNetwork(60000L)) return false;
  return modem.gprsConnect(APN, APN_USER, APN_PASS);
#endif
}

bool conectarMqtt() {
  if (!em.red) return false;               // sin SIM o sin red celular: se guardan los envíos
  if (mqtt.connected()) return true;
  if (!conectarRed()) return false;
  String id = String("riomonitor-") + BOYA + "-" + String((uint32_t)esp_random(), HEX);
  Serial.print("Conectando a MQTT...");
  bool ok = mqtt.connect(id.c_str(), MQTT_USUARIO, MQTT_CLAVE);
  Serial.println(ok ? " listo" : String(" falló (estado ") + mqtt.state() + ")");
  return ok;
}

// ================= Mensaje =================
void campo(String &j, const char *clave, float v, int dec) {
  if (isnan(v)) return;                    // sensor sin respuesta: la clave no se envía
  j += ",\""; j += clave; j += "\":"; j += String(v, dec);
}

void campoBool(String &j, const char *clave, bool v) {
  j += ",\""; j += clave; j += "\":"; j += v ? "true" : "false";
}

String jsonEnvio(const Envio &e) {
  String j = String("{\"boya\":\"") + BOYA + "\",\"n\":" + String((unsigned long)e.n);
  if (e.ts > 1700000000) j += ",\"ts\":\"" + isoUTC(e.ts) + "\"";
  campo(j, "ph", e.ph, 2);                 // pH de entrada (agua del río)
  campo(j, "tds_ppm", e.tds, 0);
  campo(j, "temp_c", e.temp, 1);
  campo(j, "turb_in_ntu", e.turbIn, 0);
  campo(j, "turb_out_ntu", e.turbOut, 0);
  campo(j, "eficiencia_pct", eficiencia(e.turbIn, e.turbOut), 1);
  campo(j, "bat_v", e.batV, 2);
  campo(j, "bat_pct", e.batPct, 0);
  campo(j, "gen_v", e.genV, 1);
  campoBool(j, "freno", e.freno);
  campoBool(j, "bomba", e.bomba);
  campoBool(j, "alerta", e.alerta);
#if ENVIAR_CAMPOS_NUEVOS
  campo(j, "ph_out", e.phOut, 2);          // pH después de los filtros
  campo(j, "caudal_lpm", e.caudal, 2);
  campo(j, "litros_total", e.litros, 1);
  campo(j, "cesta_pct", e.cesta, 0);
  campo(j, "bomba_a", e.bombaA, 2);
  j += ",\"ciclos_bomba\":" + String((unsigned long)e.ciclos);
  campo(j, "inclinacion_deg", e.inclinacion, 1);
  campoBool(j, "golpe", e.golpe);
  j += ",\"senal_csq\":" + String((int)e.csq);
#endif
  return j + "}";
}

void agregarPendiente(const Envio &e) {
  if (numPendientes == MAX_PENDIENTES) {           // lleno: se pierde el más viejo
    memmove(pendientes, pendientes + 1, sizeof(Envio) * (MAX_PENDIENTES - 1));
    numPendientes--;
  }
  pendientes[numPendientes++] = e;
}

// Publica en orden; se detiene en el primer fallo y reintenta en el siguiente periodo.
void enviarPendientes() {
  bool ok = conectarMqtt();
  int enviados = 0;
  while (ok && enviados < numPendientes) {
    ok = mqtt.publish(topico.c_str(), jsonEnvio(pendientes[enviados]).c_str());
    if (ok) {
      enviados++;
      mqtt.loop();
    }
  }
  if (enviados) {
    memmove(pendientes, pendientes + enviados, sizeof(Envio) * (numPendientes - enviados));
    numPendientes -= enviados;
    Serial.printf("  -> enviado a %s (%d mensaje%s)\n", topico.c_str(), enviados, enviados == 1 ? "" : "s");
  }
  digitalWrite(PIN_ENVIO, ok ? HIGH : LOW);
  if (numPendientes) Serial.printf("  Pendientes por enviar: %d\n", numPendientes);
}

// ================= Bluetooth (en campo, sin internet) =================
void iniciarBLE() {
#if USAR_BLE
  String nombre = String("RioMonitor-") + BOYA;
  NimBLEDevice::init(nombre.c_str());
  NimBLEServer *servidor = NimBLEDevice::createServer();
  NimBLEService *servicio = servidor->createService(BLE_SERVICIO);
  bleLecturas = servicio->createCharacteristic(BLE_LECTURAS, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  servicio->start();
  NimBLEAdvertising *anuncio = NimBLEDevice::getAdvertising();
  anuncio->addServiceUUID(BLE_SERVICIO);
  anuncio->start();
  Serial.println("Bluetooth activo: " + nombre);
#endif
}

void publicarBLE(const String &json) {
#if USAR_BLE
  if (bleLecturas) { bleLecturas->setValue(std::string(json.c_str())); bleLecturas->notify(); }
#endif
}

// ================= Programa =================
void setup() {
  Serial.begin(115200);
  const int salidas[] = { PIN_PH_IN_PWR, PIN_PH_OUT_PWR, PIN_TDS_PWR, PIN_BOMBA, PIN_FRENO,
                          PIN_ALERTA, PIN_ENVIO, PIN_TRIG };
  for (int p : salidas) {
    pinMode(p, OUTPUT);
    digitalWrite(p, LOW);
  }
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_FLUJO, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_FLUJO), alPulsoFlujo, RISING);

  Wire.begin(PIN_SDA, PIN_SCL);
  ads1Ok = ads1.begin(0x48);
  ads2Ok = ads2.begin(0x49);
  if (ads1Ok) ads1.setGain(GAIN_ONE);   // ±4.096 V: las señales llegan en 0–3.3 V
  if (ads2Ok) ads2.setGain(GAIN_ONE);
  iniciarMPU();
  termometro.begin();

  sdLista = SD.begin(PIN_SD_CS);
  if (sdLista) {
    File f = SD.open("/lecturas.csv", FILE_WRITE);
    if (f) {
      f.println("ts,ph,ph_out,tds_ppm,temp_c,turb_in_ntu,turb_out_ntu,caudal_lpm,litros_total,cesta_pct,"
                "bat_v,bat_pct,gen_v,bomba_a,bomba,freno,inclinacion_deg,alerta");
      f.close();
    }
  }

  Serial.println();
  Serial.printf("=== Río Monitor · boya %s ===\n", BOYA);
  Serial.printf("ADS1115 0x48: %s · 0x49: %s · MPU6050: %s · microSD: %s\n",
                ads1Ok ? "ok" : "NO", ads2Ok ? "ok" : "NO", mpuOk ? "ok" : "NO", sdLista ? "ok" : "NO");

  mqtt.setServer(MQTT_HOST, MQTT_PUERTO);
  mqtt.setBufferSize(1024);   // el mensaje mide ~450 bytes; el default de PubSubClient es 256
  iniciarModem();
  iniciarBLE();
  consultarModem();
  if (em.red && conectarRed()) sincronizarReloj();
  conectarMqtt();
}

void loop() {
  mqtt.loop();   // mantiene viva la conexión (keepalive)
  if (millis() - ultimaLectura < PERIODO_LECTURA_MS) return;
  float dtMin = ultimaLectura == 0 ? 0 : (millis() - ultimaLectura) / 60000.0f;
  ultimaLectura = millis();

  termometro.requestTemperatures();
  float temp = termometro.getTempCByIndex(0);
  if (temp == DEVICE_DISCONNECTED_C) temp = NAN;
  float tempComp = isnan(temp) ? 25.0f : temp;   // solo para compensar el TDS

  alimentarSolo(PIN_PH_IN_PWR);
  float phIn = aPH(voltsADS(ads1, ads1Ok, 0), PH_IN_V7, PH_IN_PEND);
  alimentarSolo(PIN_PH_OUT_PWR);
  float phOut = aPH(voltsADS(ads1, ads1Ok, 1), PH_OUT_V7, PH_OUT_PEND);
  alimentarSolo(PIN_TDS_PWR);
  float tds = aTDS(voltsADS(ads1, ads1Ok, 2), tempComp);
  alimentarSolo(-1);

  float turbIn  = aTurbidez(voltsADS(ads1, ads1Ok, 3));
  float turbOut = aTurbidez(voltsADS(ads2, ads2Ok, 0));
  float batV    = voltsADS(ads2, ads2Ok, 1) * DIVISOR_BAT;
  float genV    = voltsADS(ads2, ads2Ok, 2) * DIVISOR_GEN;
  float vAcs    = voltsADS(ads2, ads2Ok, 3);
  float bombaA  = isnan(vAcs) ? NAN : max(0.0f, (vAcs - ACS_CERO_V) / ACS_V_POR_A);
  float batPct  = porcentajeBateria(batV);

  noInterrupts();
  uint32_t pulsos = pulsosFlujo;
  pulsosFlujo = 0;
  interrupts();
  float litros = pulsos / PULSOS_POR_LITRO;
  litrosAcumulados += litros;
  float caudal = dtMin > 0 ? litros / dtMin : 0;

  float cesta = leerCestaPct();
  float inclinacion = NAN, g = 1.0f;
  bool golpe = false;
  if (leerMPU(inclinacion, g)) golpe = fabsf(g - 1.0f) > GOLPE_G;

  if (!isnan(batV) && !isnan(genV)) controlarFreno(genV, batV);
  if (!isnan(batPct)) controlarBomba(batPct);

  bool alerta = phIn < PH_MIN || phIn > PH_MAX || tds > TDS_MAX || turbIn > TURB_MAX ||
                inclinacion > INCLINACION_MAX || golpe;
  digitalWrite(PIN_ALERTA, alerta ? HIGH : LOW);

  time_t ahora = relojListo ? time(nullptr) : 0;
  ultimo.n = numEnvio + 1;       ultimo.ts = ahora;
  ultimo.ph = phIn;              ultimo.phOut = phOut;
  ultimo.tds = tds;              ultimo.temp = temp;
  ultimo.turbIn = turbIn;        ultimo.turbOut = turbOut;
  ultimo.batV = batV;            ultimo.batPct = batPct;      ultimo.genV = genV;
  ultimo.caudal = caudal;        ultimo.litros = litrosAcumulados;
  ultimo.cesta = cesta;          ultimo.bombaA = bombaA;      ultimo.inclinacion = inclinacion;
  ultimo.ciclos = ciclosBomba;   ultimo.csq = em.csq == 99 ? 0 : em.csq;
  ultimo.freno = frenoActivo;    ultimo.bomba = bombaEncendida;
  ultimo.alerta = alerta;        ultimo.golpe = golpe;

  String json = jsonEnvio(ultimo);
  Serial.println(json);
  publicarBLE(json);

  if (sdLista) {
    File f = SD.open("/lecturas.csv", FILE_APPEND);
    if (f) {
      f.printf("%s,%.2f,%.2f,%.0f,%.1f,%.0f,%.0f,%.2f,%.1f,%.0f,%.2f,%.0f,%.1f,%.2f,%d,%d,%.1f,%d\n",
               relojListo ? isoUTC(ahora).c_str() : "", phIn, phOut, tds, temp, turbIn, turbOut,
               caudal, litrosAcumulados, cesta, batV, batPct, genV, bombaA,
               bombaEncendida, frenoActivo, inclinacion, alerta);
      f.close();
    }
  }

  // Cada periodo de envío se encola la última lectura y se publica todo lo pendiente.
  if (ultimoEnvio == 0 || millis() - ultimoEnvio >= PERIODO_ENVIO_MS) {
    ultimoEnvio = millis();
    consultarModem();
    ultimo.csq = em.csq == 99 ? 0 : em.csq;
    if (!relojListo && em.red && conectarRed()) sincronizarReloj();
    numEnvio++;
    ultimo.n = numEnvio;
    if (relojListo && ultimo.ts == 0) ultimo.ts = time(nullptr);
    agregarPendiente(ultimo);
    enviarPendientes();
  }
}
