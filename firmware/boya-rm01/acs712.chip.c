// Sensor de corriente ACS712 (5 A) para Wokwi, en serie con la bomba.
// En la boya, la corriente solo pasa cuando el MOSFET de la bomba conduce (GPIO27): aquí el pin IP
// va a GPIO27 y, si está en LOW, no hay corriente. La salida es la del sensor real:
//   VIOUT = 2.5 V + 0.185 V/A × corriente     (2.5 V = 0 A)
// El control «corriente» es lo que consume la bomba cuando está prendida (0.4 A en el modelo 3D).
// Nota: los ADC virtuales de Wokwi usan 5 V de referencia; un voltaje escrito aquí se lee igual.
#include "wokwi-api.h"
#include <stdlib.h>

#define V_CERO 2.5f
#define V_POR_A 0.185f

typedef struct {
  pin_t ip, vout;
  uint32_t a_corriente;
} chip_state_t;

static void actualizar(void *ud) {
  chip_state_t *c = ud;
  float amps = pin_read(c->ip) == HIGH ? attr_read_float(c->a_corriente) : 0.0f;
  pin_dac_write(c->vout, V_CERO + V_POR_A * amps);
}

static void on_bomba(void *ud, pin_t pin, uint32_t value) {
  (void)pin;
  (void)value;
  actualizar(ud);
}

void chip_init(void) {
  chip_state_t *c = calloc(1, sizeof(chip_state_t));
  c->ip = pin_init("IP", INPUT);
  c->vout = pin_init("VIOUT", ANALOG);
  c->a_corriente = attr_init_float("corriente", 0.4f);
  actualizar(c);
  // La bomba se sigue al instante (cambio de GPIO27); el control de corriente, cada 200 ms.
  // Pocas llamadas: un temporizador rápido frena la simulación de Wokwi.
  const pin_watch_config_t w = { .edge = BOTH, .pin_change = on_bomba, .user_data = c };
  pin_watch(c->ip, &w);
  const timer_config_t t = { .callback = actualizar, .user_data = c };
  timer_start(timer_init(&t), 200000, true);
}
