/*
 * Atl-Monitor · Boya skimmer B-01 — cliente ESP32 para Wokwi
 * Proyecto: https://wokwi.com/projects/481597487801225217
 *
 * Lee los sensores de la boya y envía un POST JSON cada 3 s a  <TUNNEL_URL>/api/v1/telemetry/iot
 * El backend guarda las lecturas y las emite por /ws/live: la app móvil/tablet y el dashboard web
 * muestran el paquete en vivo («EN VIVO · ESP32»).
 *
 * ── Cómo usarlo ────────────────────────────────────────────────────────────────────────────────
 * 1) Wokwi corre en la nube y no ve tu laptop: expón el backend (puerto 8000) con un túnel HTTPS, p. ej.
 *        cloudflared tunnel --url http://localhost:8000        (o:  ngrok http 8000)
 *    y pega aquí la URL que te dé, sin barra final:  TUNNEL_URL "https://algo.trycloudflare.com"
 * 2) Pega este archivo como sketch.ino y conecta el diagrama (diagram.json) así:
 *        pH              potenciómetro  SIG → GPIO34   (0–4095 → pH 0–14)
 *        Turbidez        potenciómetro  SIG → GPIO35   (0–4095 → 0–1000 NTU)
 *        Temperatura     sensor NTC     OUT → GPIO32
 *        Oxígeno disuelto potenciómetro SIG → GPIO33   (0–4095 → 0–14 mg/L)
 *        Nivel de cesta  potenciómetro  SIG → GPIO36   (0–4095 → 0–100 %)
 *        Batería         potenciómetro  SIG → GPIO39   (0–4095 → 0–100 %)
 *        Bomba           LED + resistencia → GPIO2     (se enciende al enviar caudal)
 *    (Solo se usan pines ADC1: el ADC2 deja de funcionar mientras el WiFi está activo.)
 * 3) Corrida: el monitor serie muestra cada envío y el código HTTP (200 = guardado).
 *
 * El nodo no necesita llave. Si el backend define DEVICE_KEY, rellena DEVICE_KEY abajo (header X-Device-Key).
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <math.h>

// ── Configuración ──────────────────────────────────────────────────────────────────────────────
#define WIFI_SSID    "Wokwi-GUEST"
#define WIFI_PASS    ""
#define TUNNEL_URL   "https://CAMBIA-ESTO.trycloudflare.com"   // sin barra final
#define DEVICE_ID    "B-01"                                     // alias de la estación RM-01
#define DEVICE_KEY   ""                                         // opcional: X-Device-Key
#define SEND_EVERY_MS 3000

// ── Pines ──────────────────────────────────────────────────────────────────────────────────────
const int PIN_PH = 34, PIN_TURB = 35, PIN_TEMP = 32, PIN_DO = 33, PIN_BASKET = 36, PIN_BATT = 39;
const int PIN_PUMP_LED = 2;

const float BETA = 3950.0;  // NTC de Wokwi

uint32_t seq = 0;
uint32_t lastSend = 0;

// Promedia 8 lecturas para suavizar el ruido del ADC.
int readAdc(int pin) {
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(pin);
  return (int)(sum / 8);
}

float mapf(float x, float inMin, float inMax, float outMin, float outMax) {
  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

float readTemperatureC() {
  int raw = readAdc(PIN_TEMP);
  if (raw <= 0 || raw >= 4095) return NAN;
  return 1.0 / (log(1.0 / (4095.0 / raw - 1.0)) / BETA + 1.0 / 298.15) - 273.15;
}

void connectWifi() {
  Serial.print("WiFi ");
  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);  // canal 6: conexión rápida en Wokwi
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.printf(" conectado, RSSI %d dBm\n", WiFi.RSSI());
}

// Agrega «,"campo":valor» solo si el valor es válido (un sensor desconectado se omite).
void addField(String &json, const char *name, float value, int decimals = 2) {
  if (isnan(value) || isinf(value)) return;
  json += ",\"";
  json += name;
  json += "\":";
  json += String(value, decimals);
}

String buildPayload() {
  float ph = mapf(readAdc(PIN_PH), 0, 4095, 0, 14);
  float turbidity = mapf(readAdc(PIN_TURB), 0, 4095, 0, 1000);
  float temperature = readTemperatureC();
  float dissolvedOxygen = mapf(readAdc(PIN_DO), 0, 4095, 0, 14);
  float basketFill = mapf(readAdc(PIN_BASKET), 0, 4095, 0, 100);
  float battery = mapf(readAdc(PIN_BATT), 0, 4095, 0, 100);

  // Sin sensores físicos de caudal ni de corriente: se simulan con la hora (0.6–1.2 m/s).
  float t = millis() / 1000.0;
  float riverSpeed = 0.9 + 0.3 * sin(t / 20.0);
  bool pumpOn = turbidity > 50;               // la bomba trabaja cuando el agua está turbia
  float flowRate = pumpOn ? 12.0 + 2.0 * sin(t / 5.0) : 0.0;

  String json = "{\"device_id\":\"" DEVICE_ID "\"";
  json += ",\"seq\":" + String(seq);
  addField(json, "ph", ph);
  addField(json, "turbidity", turbidity, 1);
  addField(json, "temperature", temperature, 1);
  addField(json, "dissolved_oxygen", dissolvedOxygen);
  addField(json, "flow_rate", flowRate, 1);
  addField(json, "river_speed_ms", riverSpeed);
  addField(json, "basket_fill_pct", basketFill, 0);
  addField(json, "battery_pct", battery, 0);
  addField(json, "rssi", WiFi.RSSI(), 0);
  json += String(",\"pump_on\":") + (pumpOn ? "true" : "false");
  json += "}";
  digitalWrite(PIN_PUMP_LED, pumpOn ? HIGH : LOW);
  return json;
}

void sendTelemetry() {
  String url = String(TUNNEL_URL) + "/api/v1/telemetry/iot";
  String payload = buildPayload();

  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;
  bool https = url.startsWith("https://");
  if (https) {
    secure.setInsecure();  // prototipo: sin validar el certificado del túnel
    http.begin(secure, url);
  } else {
    http.begin(plain, url);
  }
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_KEY) > 0) http.addHeader("X-Device-Key", DEVICE_KEY);
  http.setTimeout(5000);

  int code = http.POST(payload);
  Serial.printf("[%lu] POST %s -> %d\n  %s\n", (unsigned long)seq, url.c_str(), code, payload.c_str());
  if (code <= 0) Serial.printf("  error: %s\n", http.errorToString(code).c_str());
  http.end();
  seq++;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_PUMP_LED, OUTPUT);
  analogReadResolution(12);
  connectWifi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (millis() - lastSend >= SEND_EVERY_MS) {
    lastSend = millis();
    sendTelemetry();
  }
}
