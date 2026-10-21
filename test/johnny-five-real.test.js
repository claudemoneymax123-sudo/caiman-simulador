// Prueba de integración SOLO en Node: el johnny-five real + firmata-io real +
// src/estacion.js, contra un Uno con StandardFirmata emulado byte a byte.
// Corre en tiempo real (~12 s) y usa el reloj por defecto del controlador,
// igual que en la maqueta.

import { test } from "node:test";
import assert from "node:assert/strict";
import five from "johnny-five";
import firmataIo from "firmata-io";
import { UnoFirmata } from "./uno-firmata.js";
import { crearEstacion, MODOS } from "../src/estacion.js";
import { CONFIG } from "../src/config.js";

const P = CONFIG.pines, C = CONFIG.compuerta;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// johnny-five manda el servo como ancho de pulso: 0–180° -> 600–2400 µs (pwmRange por defecto).
const us = (grados) => Math.round(600 + (grados / 180) * 1800);

test("johnny-five real + Firmata: la estación mueve los pines correctos del Uno", { timeout: 40000 }, async () => {
  const uno = new UnoFirmata();
  const io = new firmataIo.Firmata(uno);
  const board = new five.Board({ io, repl: false, debug: false, sigint: false });
  await new Promise((ok) => board.once("ready", ok));

  const log = [];
  const est = crearEstacion(five, board, CONFIG, { log: (m) => log.push(m) });
  await espera(1500);

  // Modos de pin que exige el hardware real
  assert.equal(uno.modo[P.compuerta], 4, "D9 debe estar en modo SERVO");
  assert.equal(uno.modo[P.banda], 3, "D3 debe estar en modo PWM");
  for (const p of [P.ojoRojo, P.ojoVerde, P.ojoAzul]) assert.equal(uno.modo[p], 3, `D${p} debe estar en PWM`);
  assert.equal(uno.modo[P.rugido], 1, "D8 debe estar en OUTPUT");
  assert.ok(uno.pullUp(P.contadorIR), "D2 debe ser entrada con pull-up (receptor IR de colector abierto)");

  // VERDE: boca cerrada, banda a velocidad normal tras el arranque suave, ojos verdes
  assert.equal(uno.analog[P.compuerta], us(C.cerradaDeg), "servo en la posición cerrada");
  assert.equal(uno.analog[P.banda], CONFIG.banda.normal, "banda a PWM normal");
  assert.equal(uno.analog[P.ojoRojo], 0, "ojo rojo apagado en VERDE");
  assert.ok(uno.analog[P.ojoVerde] > 0, "ojo verde encendido");
  const rampa = uno.historial.filter(([, tipo, pin]) => tipo === "analog" && pin === P.banda).map(([, , , v]) => v);
  assert.ok(rampa.length > 3 && rampa[0] < 60, `arranque suave de la banda: ${rampa.join(",")}`);

  // Contador: 5 objetos cortan el haz IR (D2 baja con pull-up)
  for (let i = 0; i < 5; i++) { uno.ponerEntrada(P.contadorIR, 0); await espera(150); uno.ponerEntrada(P.contadorIR, 1); await espera(250); }
  assert.equal(est.status().objetos, 5, `contó ${est.status().objetos}`);

  // Reloj real: el haz tapado 3,5 s debe dar ATASCO (con board.millis() de
  // johnny-five, que vuelve a 0 cada segundo, nunca llegaría a 3 s).
  uno.ponerEntrada(P.contadorIR, 0);
  await espera(3600);
  assert.equal(est.status().modo, MODOS.ATASCO, `modo ${est.status().modo}`);
  assert.equal(uno.analog[P.banda], 0, "banda detenida en el atasco");
  uno.ponerEntrada(P.contadorIR, 1);
  await espera(800);
  assert.equal(est.status().modo, MODOS.CAPTURA, `no se recuperó: ${est.status().modo}`);

  // ROJO: boca abierta, banda detenida, rugido en D8
  const t0 = Date.now();
  est.setAlerta("ROJO", "prueba");
  await espera(800);
  assert.equal(uno.analog[P.compuerta], us(C.abiertaDeg), "servo abierto en ROJO");
  assert.equal(uno.analog[P.banda], 0, "banda detenida en ROJO");
  assert.equal(uno.analog[P.ojoVerde], 0, "en ROJO no hay verde");
  assert.ok(uno.historial.some(([t, tipo, pin, v]) => t >= t0 && tipo === "digital" && pin === P.rugido && v === 1), "D8 no sonó");

  // Apagado seguro: boca abierta, todo apagado
  est.shutdown();
  await espera(200);
  assert.equal(uno.analog[P.compuerta], us(C.abiertaDeg));
  assert.equal(uno.analog[P.banda], 0);
  assert.equal(uno.digital[P.rugido], 0);

  // Tras shutdown() el ciclo se detiene: nada vuelve a encender los ojos.
  await espera(600);
  assert.deepEqual([P.ojoRojo, P.ojoVerde, P.ojoAzul].map((p) => uno.analog[p]), [0, 0, 0], "los ojos se volvieron a encender");
  board.io.transport.close();
});
