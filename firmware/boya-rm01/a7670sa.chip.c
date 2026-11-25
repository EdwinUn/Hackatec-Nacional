// Módem 4G SIMCom A7670SA para Wokwi (Wokwi no simula la red celular).
// Responde a los comandos AT que usa el firmware: encendido por PWRKEY,
// estado de la SIM, señal, registro en la red, operador y hora de la red.
// Controles en la simulación: SIM insertada, señal (CSQ) y red disponible.
// Los datos de la boya salen por el WiFi de Wokwi; el módem decide si hay
// "red" para enviarlos, igual que en el río.
#include "wokwi-api.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdint.h>
#include <stdbool.h>

#define OUT_MAX 2048
#define CHUNK 64

typedef struct {
  uart_dev_t uart;
  pin_t pwrkey, status, netlight;
  uint32_t a_sim, a_senal, a_red;
  bool on, booting, echo, led;
  uint64_t key_down_ns, on_ns;
  char line[256]; int len;
  char out[OUT_MAX]; int out_len;
  uint8_t txbuf[2][CHUNK]; int tx_pending, tx_idx;
  timer_t t_tx, t_boot, t_led;
} chip_state_t;

static void enviar(chip_state_t *c, const char *s) {
  int n = (int)strlen(s);
  if (c->out_len + n > OUT_MAX) n = OUT_MAX - c->out_len;
  memcpy(c->out + c->out_len, s, n);
  c->out_len += n;
}

// Envía la salida en bloques; uart_write devuelve false mientras transmite el anterior.
static void on_tx_timer(void *ud) {
  chip_state_t *c = ud;
  if (c->tx_pending == 0 && c->out_len > 0) {
    int n = c->out_len < CHUNK ? c->out_len : CHUNK;
    memcpy(c->txbuf[c->tx_idx], c->out, n);
    memmove(c->out, c->out + n, c->out_len - n);
    c->out_len -= n;
    c->tx_pending = n;
  }
  if (c->tx_pending > 0 && uart_write(c->uart, c->txbuf[c->tx_idx], c->tx_pending)) {
    c->tx_pending = 0;
    c->tx_idx ^= 1;
  }
}

static bool sim_ok(chip_state_t *c) { return attr_read(c->a_sim) != 0; }
static bool registrado(chip_state_t *c) { return c->on && sim_ok(c) && attr_read(c->a_red) != 0 && attr_read(c->a_senal) > 0; }

static void on_led_timer(void *ud) {
  chip_state_t *c = ud;
  if (!c->on) { pin_write(c->netlight, LOW); return; }
  c->led = !c->led;
  pin_write(c->netlight, c->led ? HIGH : LOW);
  // Registrado: parpadeo lento. Buscando red: parpadeo rápido.
  timer_start(c->t_led, registrado(c) ? (c->led ? 100000 : 1500000) : 200000, false);
}

static void on_boot_timer(void *ud) {
  chip_state_t *c = ud;
  c->booting = false;
  c->on = true;
  c->echo = true;
  c->on_ns = get_sim_nanos();
  pin_write(c->status, HIGH);
  enviar(c, "\r\nRDY\r\n");
  if (sim_ok(c)) enviar(c, "\r\n+CPIN: READY\r\n\r\nSMS DONE\r\n\r\nPB DONE\r\n");
  timer_start(c->t_led, 200000, false);
  printf("A7670SA encendido\n");
}

static void on_pwrkey(void *ud, pin_t pin, uint32_t value) {
  chip_state_t *c = ud;
  (void)pin;
  if (value == LOW) { c->key_down_ns = get_sim_nanos(); return; }
  uint64_t ms = (get_sim_nanos() - c->key_down_ns) / 1000000;
  if (!c->on && !c->booting && ms >= 50) {
    c->booting = true;
    timer_start(c->t_boot, 2000000, false);          // arranca en ~2 s
  } else if (c->on && ms >= 2500) {
    c->on = false;
    pin_write(c->status, LOW);
    pin_write(c->netlight, LOW);
    enviar(c, "\r\nNORMAL POWER DOWN\r\n");
  }
}

static void ok(chip_state_t *c) { enviar(c, "\r\nOK\r\n"); }

static void procesar(chip_state_t *c, char *cmd) {
  char r[160];
  for (char *p = cmd; *p; p++) *p = (char)toupper((unsigned char)*p);
  if (strcmp(cmd, "AT") == 0) { ok(c); return; }
  if (strcmp(cmd, "ATE0") == 0) { c->echo = false; ok(c); return; }
  if (strcmp(cmd, "ATE1") == 0) { c->echo = true; ok(c); return; }
  if (strcmp(cmd, "ATI") == 0 || strcmp(cmd, "AT+CGMM") == 0 || strcmp(cmd, "AT+GMM") == 0) {
    enviar(c, "\r\nManufacturer: SIMCOM INCORPORATED\r\nModel: A7670SA\r\nRevision: A7670M7_V1.11.1\r\n"); ok(c); return;
  }
  if (strcmp(cmd, "AT+CGSN") == 0 || strcmp(cmd, "AT+GSN") == 0) { enviar(c, "\r\n860000000000001\r\n"); ok(c); return; }
  if (strcmp(cmd, "AT+CPIN?") == 0) {
    if (sim_ok(c)) { enviar(c, "\r\n+CPIN: READY\r\n"); ok(c); }
    else enviar(c, "\r\n+CME ERROR: SIM not inserted\r\n");
    return;
  }
  if (strcmp(cmd, "AT+CICCID") == 0 || strcmp(cmd, "AT+CCID") == 0) {
    if (sim_ok(c)) { enviar(c, "\r\n+ICCID: 8952020000000000001\r\n"); ok(c); }
    else enviar(c, "\r\n+CME ERROR: SIM not inserted\r\n");
    return;
  }
  if (strcmp(cmd, "AT+CSQ") == 0) {
    int s = c->on && attr_read(c->a_red) ? (int)attr_read(c->a_senal) : 99;
    snprintf(r, sizeof r, "\r\n+CSQ: %d,99\r\n", s); enviar(c, r); ok(c); return;
  }
  if (strcmp(cmd, "AT+CREG?") == 0 || strcmp(cmd, "AT+CGREG?") == 0 || strcmp(cmd, "AT+CEREG?") == 0) {
    const char *tipo = cmd[3] == 'R' ? "CREG" : cmd[3] == 'G' ? "CGREG" : "CEREG";
    int stat = !sim_ok(c) ? 0 : registrado(c) ? 1 : 2;     // 1 = registrado, 2 = buscando
    snprintf(r, sizeof r, "\r\n+%s: 0,%d\r\n", tipo, stat); enviar(c, r); ok(c); return;
  }
  if (strcmp(cmd, "AT+COPS?") == 0) {
    enviar(c, registrado(c) ? "\r\n+COPS: 0,0,\"TELCEL\",7\r\n" : "\r\n+COPS: 0\r\n"); ok(c); return;
  }
  if (strcmp(cmd, "AT+CGATT?") == 0 || strcmp(cmd, "AT+NETOPEN?") == 0) {
    snprintf(r, sizeof r, "\r\n+%s: %d\r\n", cmd[3] == 'G' ? "CGATT" : "NETOPEN", registrado(c) ? 1 : 0); enviar(c, r); ok(c); return;
  }
  if (strcmp(cmd, "AT+CCLK?") == 0) {
    // Hora de la red: 24/11/2026 17:00:00 (UTC-6) más el tiempo simulado desde el arranque
    uint64_t s = (get_sim_nanos() - c->on_ns) / 1000000000ULL + 17 * 3600;
    snprintf(r, sizeof r, "\r\n+CCLK: \"26/11/24,%02d:%02d:%02d-24\"\r\n", (int)(s / 3600 % 24), (int)(s / 60 % 60), (int)(s % 60));
    enviar(c, r); ok(c); return;
  }
  if (strcmp(cmd, "AT+CRESET") == 0) { ok(c); c->on = false; pin_write(c->status, LOW); c->booting = true; timer_start(c->t_boot, 2000000, false); return; }
  if (strncmp(cmd, "AT+CPOF", 7) == 0) { ok(c); c->on = false; pin_write(c->status, LOW); return; }
  if (strncmp(cmd, "AT", 2) == 0) { ok(c); return; }     // configuración (CMEE, CGDCONT, CFUN...): se acepta
  enviar(c, "\r\nERROR\r\n");
}

static void on_rx(void *ud, uint8_t b) {
  chip_state_t *c = ud;
  if (!c->on) return;                                     // apagado: no contesta
  if (c->echo) { char e[2] = { (char)b, 0 }; enviar(c, e); }
  if (b == '\r' || b == '\n') {
    if (c->len > 0) { c->line[c->len] = 0; procesar(c, c->line); c->len = 0; }
  } else if (c->len < (int)sizeof(c->line) - 1) {
    c->line[c->len++] = (char)b;
  }
}

void chip_init(void) {
  chip_state_t *c = calloc(1, sizeof(chip_state_t));
  c->a_sim = attr_init("sim", 1);
  c->a_senal = attr_init("senal", 22);
  c->a_red = attr_init("red", 1);
  c->status = pin_init("STATUS", OUTPUT_LOW);
  c->netlight = pin_init("NETLIGHT", OUTPUT_LOW);
  c->pwrkey = pin_init("PWRKEY", INPUT_PULLUP);

  const uart_config_t ucfg = {
    .tx = pin_init("TXD", INPUT_PULLUP),
    .rx = pin_init("RXD", INPUT),
    .baud_rate = 115200,
    .rx_data = on_rx,
    .user_data = c,
  };
  c->uart = uart_init(&ucfg);

  const timer_config_t ttx = { .callback = on_tx_timer, .user_data = c };
  const timer_config_t tboot = { .callback = on_boot_timer, .user_data = c };
  const timer_config_t tled = { .callback = on_led_timer, .user_data = c };
  c->t_tx = timer_init(&ttx);
  c->t_boot = timer_init(&tboot);
  c->t_led = timer_init(&tled);
  timer_start(c->t_tx, 500, true);

  const pin_watch_config_t w = { .edge = BOTH, .pin_change = on_pwrkey, .user_data = c };
  pin_watch(c->pwrkey, &w);
  printf("A7670SA listo: pulsa PWRKEY para encender\n");
}
