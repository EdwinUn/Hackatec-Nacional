// ADS1115 para Wokwi (Wokwi no lo trae). Emula lo que usa la librería
// Adafruit_ADS1X15: registros de conversión y configuración, MUX de entradas
// (simples y diferenciales), ganancia (PGA) y modo de un disparo o continuo.
// La dirección I2C se elige con el atributo "address" en diagram.json
// (72 = 0x48, 73 = 0x49), como en el real se elige con el pin ADDR.
#include "wokwi-api.h"
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <math.h>

typedef struct {
  pin_t ain[4];
  uint8_t pointer;      // 0 conversión, 1 configuración, 2 umbral bajo, 3 umbral alto
  uint16_t regs[4];
  uint8_t wbuf[2];
  int windex;           // -1: el siguiente byte escrito es el puntero
  int rindex;
} chip_state_t;

static float escala_pga(uint16_t cfg) {
  switch ((cfg >> 9) & 7) {
    case 0: return 6.144f;
    case 1: return 4.096f;
    case 2: return 2.048f;
    case 3: return 1.024f;
    case 4: return 0.512f;
    default: return 0.256f;
  }
}

static void convertir(chip_state_t *c) {
  uint16_t cfg = c->regs[1];
  int mux = (cfg >> 12) & 7;
  float v;
  switch (mux) {
    case 0: v = pin_adc_read(c->ain[0]) - pin_adc_read(c->ain[1]); break;
    case 1: v = pin_adc_read(c->ain[0]) - pin_adc_read(c->ain[3]); break;
    case 2: v = pin_adc_read(c->ain[1]) - pin_adc_read(c->ain[3]); break;
    case 3: v = pin_adc_read(c->ain[2]) - pin_adc_read(c->ain[3]); break;
    default: v = pin_adc_read(c->ain[mux - 4]); break;
  }
  long codigo = lroundf(v / escala_pga(cfg) * 32768.0f);
  if (codigo > 32767) codigo = 32767;
  if (codigo < -32768) codigo = -32768;
  c->regs[0] = (uint16_t)(int16_t)codigo;
  c->regs[1] |= 0x8000;   // OS = 1: conversión terminada
}

static bool on_connect(void *ud, uint32_t address, bool read) {
  chip_state_t *c = ud;
  c->windex = -1;
  c->rindex = 0;
  bool continuo = (c->regs[1] & 0x0100) == 0;
  if (read && c->pointer == 0 && continuo) convertir(c);
  return true;
}

static uint8_t on_read(void *ud) {
  chip_state_t *c = ud;
  uint16_t r = c->regs[c->pointer & 3];
  uint8_t b = (c->rindex == 0) ? (uint8_t)(r >> 8) : (uint8_t)(r & 0xFF);
  c->rindex++;
  return b;
}

static bool on_write(void *ud, uint8_t data) {
  chip_state_t *c = ud;
  if (c->windex < 0) {
    c->pointer = data & 3;
    c->windex = 0;
  } else if (c->windex < 2) {
    c->wbuf[c->windex++] = data;
  }
  return true;
}

static void on_disconnect(void *ud) {
  chip_state_t *c = ud;
  if (c->windex == 2) {
    uint16_t v = ((uint16_t)c->wbuf[0] << 8) | c->wbuf[1];
    if (c->pointer == 1) {
      c->regs[1] = v;
      if (v & 0x8000) convertir(c);   // OS = 1: iniciar conversión
    } else if (c->pointer >= 2) {
      c->regs[c->pointer] = v;
    }
  }
  c->windex = -1;
}

void chip_init(void) {
  chip_state_t *c = calloc(1, sizeof(chip_state_t));
  c->ain[0] = pin_init("A0", ANALOG);
  c->ain[1] = pin_init("A1", ANALOG);
  c->ain[2] = pin_init("A2", ANALOG);
  c->ain[3] = pin_init("A3", ANALOG);
  c->regs[1] = 0x8583;   // valores de arranque del datasheet
  c->regs[2] = 0x8000;
  c->regs[3] = 0x7FFF;
  c->windex = -1;

  uint32_t attr_dir = attr_init("address", 0x48);
  uint32_t dir = attr_read(attr_dir);

  const i2c_config_t cfg = {
    .address = dir,
    .scl = pin_init("SCL", INPUT_PULLUP),
    .sda = pin_init("SDA", INPUT_PULLUP),
    .connect = on_connect,
    .read = on_read,
    .write = on_write,
    .disconnect = on_disconnect,
    .user_data = c,
  };
  i2c_init(&cfg);
  printf("ADS1115 listo en 0x%02X\n", (unsigned)dir);
}
