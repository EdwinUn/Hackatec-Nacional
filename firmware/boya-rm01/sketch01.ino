/*
  Río Monitor · Boya de bajo costo (versión de ~$4,800 MXN)
  Firmware ESP32 que publica la telemetría por MQTT; el backend FastAPI se suscribe al mismo
  broker y la guarda en la base de datos:
      tópico  riomonitor/RM-01/telemetria   (RM-01 = `code` de la estación en el backend)
      mensaje {"boya":"RM-01","n":1,"ts":"…","ph":…,"tds_ppm":…,"temp_c":…, …}

  Simulación en Wokwi: https://wokwi.com
  Los sensores que Wokwi no tiene (pH, TDS, turbidez) son potenciómetros.
  libraries.txt de Wokwi: OneWire, DallasTemperature, PubSubClient

  Prototipo real                    Simulación
  -------------------------------   -----------------------------
  PH-4502C (vía ADS1115)            Potenciómetro "pH"        GPIO36 (VP)
  TDS genérico (vía ADS1115)        Potenciómetro "TDS"       GPIO39 (VN)
  Turbidez entrada                  Potenciómetro             GPIO34
  Turbidez salida (tras filtros)    Potenciómetro             GPIO35
  Divisor 100k/33k de la batería    Deslizador "Batería"      GPIO32
  Divisor 100k/10k del generador    Deslizador "Generador"    GPIO33
  DS18B20 sumergible                DS18B20                   GPIO5
  microSD (registro CSV)            microSD                   CS13 SCK18 MISO19 MOSI23
  Alimentación del TDS              LED amarillo              GPIO26
  MOSFET de la bomba                LED azul                  GPIO27
  Alerta de contaminación           LED rojo                  GPIO2
  Envío al backend correcto         LED verde                 GPIO25
  MOSFET de la resistencia de       LED naranja               GPIO14
  descarga (freno del molino)
  Módem 4G A7670SA (UART2)          (no existe en Wokwi)      RX16 TX17 PWRKEY4
  Bluetooth BLE                     integrado en el ESP32     sin pines

  Conexión a internet:
  - MODO_SIMULACION 1: WiFi simulado de Wokwi ("Wokwi-GUEST").
  - MODO_SIMULACION 0: módem 4G con la SIM (boya real).
  El código que arma y publica el mensaje es el mismo en los dos casos.

  Backend: MQTT_URL=mqtt://<MQTT_HOST>:<MQTT_PUERTO> en backend/.env (el mismo broker de aquí).
  No hace falta pegar IDs de sensores: el backend los encuentra por el código de la boya.
*/

#define MODO_SIMULACION 1   // 1 = Wokwi (WiFi), 0 = boya real (módem 4G)
#define USAR_BLE        0   // 1 = lecturas por Bluetooth en campo (Wokwi no simula BLE)

#include <OneWire.h>
#include <DallasTemperature.h>
#include <SPI.h>
#include <SD.h>
#include <time.h>
#include <sys/time.h>
#include <PubSubClient.h>

#if MODO_SIMULACION
  #include <WiFi.h>
  WiFiClient red;
#else
  // El A7670SA usa los mismos comandos AT que el SIM7600.
  #define TINY_GSM_MODEM_SIM7600
  #include <TinyGsmClient.h>
  HardwareSerial SerialModem(2);
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
// Para la segunda boya, abre otra simulación de Wokwi con este sketch y cambia solo esta línea.
const char *BOYA         = "RM-01";
String topico = String("riomonitor/") + BOYA + "/telemetria";

PubSubClient mqtt(red);

// ---------- Pines ----------
const int PIN_PH        = 36;
const int PIN_TDS       = 39;
const int PIN_TURB_IN   = 34;
const int PIN_TURB_OUT  = 35;
const int PIN_BAT       = 32;
const int PIN_GENERADOR = 33;
const int PIN_ONEWIRE   = 5;
const int PIN_SD_CS     = 13;
const int PIN_TDS_PWR   = 26;
const int PIN_BOMBA     = 27;
const int PIN_ALERTA    = 2;
const int PIN_ENVIO     = 25;
const int PIN_FRENO     = 14;
const int PIN_MODEM_RX  = 16;   // llega del TX del módem
const int PIN_MODEM_TX  = 17;   // va al RX del módem
const int PIN_MODEM_PWR = 4;    // PWRKEY del módem

// ---------- Calibración (se ajusta con soluciones buffer en el real) ----------
const float VREF          = 3.3;
const float PH_VOLT_PH7   = 1.65;    // voltaje con buffer pH 7
const float PH_PENDIENTE  = 0.2357;  // V por unidad de pH
const float DIVISOR_BAT   = 4.03;    // (100k + 33k) / 33k
const float BAT_VACIA     = 9.0;     // 3 celdas Li-ion a 3.0 V
const float BAT_LLENA     = 12.6;    // 3 celdas Li-ion a 4.2 V
const float DIVISOR_GEN   = 11.0;    // (100k + 10k) / 10k  -> 3.3 V = 36 V

// ---------- Protección contra sobrecarga ----------
// El cargador CC/CV ya limita la batería a 12.6 V. El riesgo es el generador:
// si la batería se llena o el río corre muy rápido, el molino se acelera y su
// voltaje sube. La resistencia de descarga (en paralelo al generador) lo frena.
const float GEN_V_FRENAR      = 26.0;  // V: protege al cargador (aguanta 36 V)
const float GEN_V_SOLTAR      = 22.0;
const float BAT_V_LLENA_FRENO = 12.5;  // V: batería llena, la energía sobrante se va al freno
const float BAT_V_SOLTAR      = 12.3;

// ---------- Ciclo de tratamiento ----------
const float BAT_PARAR     = 35.0;
const float BAT_ARRANCAR  = 75.0;

// ---------- Alertas locales (el backend evalúa las suyas) ----------
const float PH_MIN = 6.5, PH_MAX = 8.5;
const float TDS_MAX  = 500.0;
const float TURB_MAX = 50.0;

// ---------- Tiempos ----------
#if MODO_SIMULACION
const unsigned long PERIODO_LECTURA_MS = 3000;
const unsigned long PERIODO_ENVIO_MS   = 15000;    // demo: cada 15 s
#else
const unsigned long PERIODO_LECTURA_MS = 30000;
const unsigned long PERIODO_ENVIO_MS   = 300000;   // cada 5 min
#endif

// ---------- Buffer de envíos pendientes ----------
// Si no hay señal, los envíos se guardan y se publican en orden al reconectar.
// Cada uno lleva su propia hora (si el reloj está sincronizado), así el backend
// los guarda en el instante en que se midieron.
struct Envio {
  uint32_t n;
  time_t ts;            // 0 = sin hora: el backend usa la hora de llegada
  float ph, tds, temp, turbIn, turbOut, batV, batPct, genV;
  bool freno, bomba, alerta;
};
const int MAX_PENDIENTES = 120;            // ≈ 10 h sin señal con envíos cada 5 min
Envio pendientes[MAX_PENDIENTES];
int numPendientes = 0;

OneWire oneWire(PIN_ONEWIRE);
DallasTemperature termometro(&oneWire);

bool sdLista = false;
bool bombaEncendida = false;
bool relojListo = false;
unsigned long ultimaLectura = 0;
unsigned long ultimoEnvio = 0;
uint32_t numEnvio = 0;
Envio ultimo;

// ================= Sensores =================
float leerVoltaje(int pin) {
  long suma = 0;
  for (int i = 0; i < 20; i++) {
    suma += analogRead(pin);
    delay(2);
  }
  return (suma / 20.0) * VREF / 4095.0;
}

float leerPH() {
  float v = leerVoltaje(PIN_PH);
  return constrain(7.0 + (PH_VOLT_PH7 - v) / PH_PENDIENTE, 0.0f, 14.0f);
}

// El TDS solo se enciende mientras se lee, para no alterar el electrodo de pH.
float leerTDS(float tempC) {
  digitalWrite(PIN_TDS_PWR, HIGH);
  delay(150);
  float v = leerVoltaje(PIN_TDS);
  digitalWrite(PIN_TDS_PWR, LOW);
  float vComp = v / (1.0 + 0.02 * (tempC - 25.0));
  float tds = (133.42 * pow(vComp, 3) - 255.86 * pow(vComp, 2) + 857.39 * vComp) * 0.5;
  return max(tds, 0.0f);
}

float leerTurbidez(int pin) {
  float v = leerVoltaje(pin);
  return constrain((1.0f - v / VREF) * 1000.0f, 0.0f, 1000.0f);
}

float porcentajeBateria(float volts) {
  return constrain((volts - BAT_VACIA) / (BAT_LLENA - BAT_VACIA) * 100.0f, 0.0f, 100.0f);
}

// Cuánta turbidez quitan los filtros (0–100 %).
float eficiencia(float turbIn, float turbOut) {
  if (turbIn <= 0) return 0;
  return constrain((turbIn - turbOut) / turbIn * 100.0f, 0.0f, 100.0f);
}

bool frenoActivo = false;

void controlarFreno(float genV, float batV) {
  bool sobreVoltaje = genV > GEN_V_FRENAR;
  bool bateriaLlena = batV >= BAT_V_LLENA_FRENO && genV > batV;
  if (!frenoActivo && (sobreVoltaje || bateriaLlena)) frenoActivo = true;
  if (frenoActivo && genV < GEN_V_SOLTAR && batV < BAT_V_SOLTAR) frenoActivo = false;
  digitalWrite(PIN_FRENO, frenoActivo ? HIGH : LOW);
}

void controlarBomba(float bateriaPct) {
  if (bombaEncendida && bateriaPct < BAT_PARAR) bombaEncendida = false;
  if (!bombaEncendida && bateriaPct > BAT_ARRANCAR) bombaEncendida = true;
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
    t.tm_year = y - 1900; t.tm_mon = mo - 1; t.tm_mday = d;
    t.tm_hour = h; t.tm_min = mi; t.tm_sec = s;
    setenv("TZ", "UTC0", 1); tzset();
    time_t local = mktime(&t);
    struct timeval tv = { (time_t)(local - (time_t)(tz * 3600)), 0 };
    settimeofday(&tv, nullptr);
  }
#endif
  relojListo = time(nullptr) > 1700000000;
  Serial.println(relojListo ? "Reloj sincronizado (UTC)" : "Reloj sin sincronizar: el backend usará la hora de llegada");
}

String isoUTC(time_t ts) {
  struct tm t;
  gmtime_r(&ts, &t);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

// ================= Conexión =================
#if MODO_SIMULACION
unsigned long wifiInicioMs = 0;
#endif

bool conectarRed() {
#if MODO_SIMULACION
  if (WiFi.status() == WL_CONNECTED) return true;
  // WiFi.begin reinicia la asociación: si se llama en cada intento, una conexión lenta nunca
  // termina. Se llama una vez y solo se repite si después de 60 s sigue sin conectar.
  if (wifiInicioMs == 0 || millis() - wifiInicioMs > 60000) {
    WiFi.disconnect();
    WiFi.mode(WIFI_STA);
    WiFi.begin("Wokwi-GUEST", "", 6);
    wifiInicioMs = millis();
  }
  Serial.print("Conectando a WiFi simulado");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(" listo, IP ");
    Serial.println(WiFi.localIP());
    return true;
  }
  // 1 = no encuentra la red, 4 = falló la conexión, 6 = desconectado (sigue intentando)
  Serial.printf(" sin conexión (estado WiFi %d)\n", WiFi.status());
  return false;
#else
  if (modem.isGprsConnected()) return true;
  Serial.println("Buscando red celular...");
  if (!modem.waitForNetwork(60000L)) return false;
  Serial.print("Operador: ");
  Serial.println(modem.getOperator());
  return modem.gprsConnect(APN, APN_USER, APN_PASS);
#endif
}

bool conectarMqtt() {
  if (mqtt.connected()) return true;
  if (!conectarRed()) return false;
  String id = String("riomonitor-") + BOYA + "-" + String((uint32_t)esp_random(), HEX);
  Serial.print("Conectando a MQTT...");
  bool ok = mqtt.connect(id.c_str(), MQTT_USUARIO, MQTT_CLAVE);
  Serial.println(ok ? " listo" : String(" falló (estado ") + mqtt.state() + ")");
  return ok;
}

void iniciarModem() {
#if !MODO_SIMULACION
  pinMode(PIN_MODEM_PWR, OUTPUT);
  digitalWrite(PIN_MODEM_PWR, HIGH);
  delay(100);
  digitalWrite(PIN_MODEM_PWR, LOW);    // pulso de encendido
  delay(1000);
  digitalWrite(PIN_MODEM_PWR, HIGH);
  SerialModem.begin(115200, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
  delay(3000);
  modem.restart();
  Serial.print("Módem: ");
  Serial.println(modem.getModemInfo());
#endif
}

// ================= Envío al backend =================
// Mismo formato que acepta POST /api/v1/devices/RM-01/telemetry.
String jsonEnvio(const Envio &e) {
  String json = String("{\"boya\":\"") + BOYA + "\",\"n\":" + e.n;
  if (e.ts > 1700000000) json += ",\"ts\":\"" + isoUTC(e.ts) + "\"";
  json += ",\"ph\":" + String(e.ph, 2) + ",\"tds_ppm\":" + String(e.tds, 0) +
    ",\"temp_c\":" + String(e.temp, 1) + ",\"turb_in_ntu\":" + String(e.turbIn, 0) +
    ",\"turb_out_ntu\":" + String(e.turbOut, 0) +
    ",\"eficiencia_pct\":" + String(eficiencia(e.turbIn, e.turbOut), 1) +
    ",\"bat_v\":" + String(e.batV, 2) + ",\"bat_pct\":" + String(e.batPct, 0) +
    ",\"gen_v\":" + String(e.genV, 1) + ",\"freno\":" + (e.freno ? "true" : "false") +
    ",\"bomba\":" + (e.bomba ? "true" : "false") + ",\"alerta\":" + (e.alerta ? "true" : "false") + "}";
  return json;
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
  NimBLEDevice::init("RioMonitor-RM01");
  NimBLEServer *servidor = NimBLEDevice::createServer();
  NimBLEService *servicio = servidor->createService(BLE_SERVICIO);
  bleLecturas = servicio->createCharacteristic(BLE_LECTURAS, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  servicio->start();
  NimBLEAdvertising *anuncio = NimBLEDevice::getAdvertising();
  anuncio->addServiceUUID(BLE_SERVICIO);
  anuncio->start();
  Serial.println("Bluetooth activo: RioMonitor-RM01");
#endif
}

void publicarBLE(const String &json) {
#if USAR_BLE
  if (bleLecturas) {
    bleLecturas->setValue(std::string(json.c_str()));
    bleLecturas->notify();
  }
#endif
}

// ================= Programa =================
void setup() {
  Serial.begin(115200);
  pinMode(PIN_TDS_PWR, OUTPUT);
  pinMode(PIN_BOMBA, OUTPUT);
  pinMode(PIN_ALERTA, OUTPUT);
  pinMode(PIN_ENVIO, OUTPUT);
  pinMode(PIN_FRENO, OUTPUT);
  digitalWrite(PIN_FRENO, LOW);
  digitalWrite(PIN_TDS_PWR, LOW);
  analogReadResolution(12);

  termometro.begin();

  sdLista = SD.begin(PIN_SD_CS);
  if (sdLista) {
    File f = SD.open("/lecturas.csv", FILE_WRITE);
    if (f) {
      f.println("ts,ph,tds_ppm,temp_c,turb_in_ntu,turb_out_ntu,bat_v,bat_pct,gen_v,freno,bomba,alerta");
      f.close();
    }
  }

  Serial.println();
  Serial.println("=== Río Monitor · boya de bajo costo ===");
  Serial.println(sdLista ? "microSD lista: /lecturas.csv" : "microSD no detectada (sigue sin registro)");

  mqtt.setServer(MQTT_HOST, MQTT_PUERTO);
  mqtt.setBufferSize(512);   // el mensaje mide ~300 bytes; el default de PubSubClient es 256
  iniciarModem();
  iniciarBLE();
  if (conectarRed()) sincronizarReloj();
  conectarMqtt();
}

void loop() {
  mqtt.loop();   // mantiene viva la conexión (keepalive)
  if (millis() - ultimaLectura < PERIODO_LECTURA_MS) return;
  ultimaLectura = millis();

  termometro.requestTemperatures();
  float temp = termometro.getTempCByIndex(0);
  if (temp == DEVICE_DISCONNECTED_C) temp = 25.0;

  float ph      = leerPH();          // TDS apagado durante esta lectura
  float tds     = leerTDS(temp);
  float turbIn  = leerTurbidez(PIN_TURB_IN);
  float turbOut = leerTurbidez(PIN_TURB_OUT);

  float batV   = leerVoltaje(PIN_BAT) * DIVISOR_BAT;
  float batPct = porcentajeBateria(batV);
  float genV   = leerVoltaje(PIN_GENERADOR) * DIVISOR_GEN;

  controlarFreno(genV, batV);
  controlarBomba(batPct);
  bool alerta = ph < PH_MIN || ph > PH_MAX || tds > TDS_MAX || turbIn > TURB_MAX;
  digitalWrite(PIN_ALERTA, alerta ? HIGH : LOW);

  time_t ahora = relojListo ? time(nullptr) : 0;
  ultimo = { numEnvio + 1, ahora, ph, tds, temp, turbIn, turbOut, batV, batPct, genV,
             frenoActivo, bombaEncendida, alerta };
  String json = jsonEnvio(ultimo);
  Serial.println(json);
  publicarBLE(json);

  if (sdLista) {
    File f = SD.open("/lecturas.csv", FILE_APPEND);
    if (f) {
      f.printf("%s,%.2f,%.0f,%.1f,%.0f,%.0f,%.2f,%.0f,%.1f,%d,%d,%d\n",
               relojListo ? isoUTC(ahora).c_str() : "", ph, tds, temp, turbIn, turbOut,
               batV, batPct, genV, frenoActivo, bombaEncendida, alerta);
      f.close();
    }
  }

  // Cada periodo de envío se encola la última lectura y se publica todo lo pendiente.
  if (ultimoEnvio == 0 || millis() - ultimoEnvio >= PERIODO_ENVIO_MS) {
    ultimoEnvio = millis();
    if (!relojListo) sincronizarReloj();
    numEnvio++;
    ultimo.n = numEnvio;
    if (relojListo && ultimo.ts == 0) ultimo.ts = time(nullptr);
    agregarPendiente(ultimo);
    enviarPendientes();
  }
}
