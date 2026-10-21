// Pruebas del cerebro, del aguacero y de la estación sobre el hardware virtual.
// Corren en Node (`npm test`) y en el navegador (test/index.html).

import { crearEstacion, MODOS } from "../src/estacion.js";
import { crearCerebro } from "../src/cerebro.js";
import { crearAguacero, crearFuenteDemo, OJOS_DEMO } from "../src/aguacero.js";
import { CONFIG, UMBRALES } from "../src/config.js";
import { VirtualWorld, createVirtualFive } from "../sim/virtual-five.js";

const C = CONFIG.compuerta, IR = CONFIG.pines.contadorIR;
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Banco de pruebas: estación sobre hardware virtual. `alerta` se reenvía cada 5 s
// (como si el servidor respondiera GET /alerta); null = no llega nada.
function banco(worldOpts = {}) {
  const world = new VirtualWorld({ seed: 42, ...worldOpts });
  const five = createVirtualFive(world);
  const board = new five.Board();
  const b = { world, board, est: null, log: [], alerta: "VERDE", modos: new Set(), maxRugido: 0 };
  board.on("error", () => {});
  board.on("ready", () => { b.est = crearEstacion(five, board, CONFIG, { log: (m) => b.log.push(m), reloj: () => world.time }); });
  let ultimoEnvio = -1e9;
  b.run = (ms, cada) => {
    for (let t = 0; t < ms; t += 5) {
      world.step(5);
      if (b.est && b.alerta && world.time - ultimoEnvio >= 5000) { b.est.setAlerta(b.alerta); ultimoEnvio = world.time; }
      if (b.est) b.modos.add(b.est.status().modo);
      cada?.(b);
    }
    return b;
  };
  b.st = () => b.est.status();
  b.servo = () => world.servos[0];
  b.motor = () => world.motores[0];
  b.pulso = (msCortado, msLibre = 300) => { world.setDigital(IR, 0); b.run(msCortado); world.setDigital(IR, 1); b.run(msLibre); };
  return b;
}

export const tests = [
  // ---- Cerebro --------------------------------------------------------------
  ["cerebro: sin lecturas = VERDE", () => {
    assert(crearCerebro().alertaEstacion(0).nivel === "VERDE", "debería ser VERDE");
  }],

  ["cerebro: lluvia fuerte en 10 min = AMARILLO", () => {
    const c = crearCerebro();
    for (let t = 0; t <= 300; t += 60) c.agregarLectura({ id: 1, t, nivelCm: 10, lluviaMm: 2 });
    const a = c.alertaEstacion(300);
    assert(a.nivel === "AMARILLO", `${a.nivel} (${a.motivo})`);
  }],

  ["cerebro: el nivel sube rápido = NARANJA", () => {
    const c = crearCerebro();
    [10, 15, 25, 35].forEach((n, i) => c.agregarLectura({ id: 2, t: i * 60, nivelCm: n }));
    const a = c.alertaEstacion(180);
    assert(a.nivel === "NARANJA", `${a.nivel} (${a.motivo})`);
  }],

  ["cerebro: sobre la cota de desborde = ROJO", () => {
    const c = crearCerebro();
    c.agregarLectura({ id: 5, t: 0, nivelCm: UMBRALES.ojos[4].cotaDesbordeCm + 1 });
    assert(c.alertaEstacion(0).nivel === "ROJO", "debería ser ROJO");
  }],

  ["cerebro: la alerta sube de inmediato y baja solo tras 5 min", () => {
    const c = crearCerebro();
    c.agregarLectura({ id: 5, t: 0, nivelCm: 200 });
    assert(c.alertaEstacion(0).nivel === "ROJO", "no subió");
    c.agregarLectura({ id: 5, t: 60, nivelCm: 20 });
    assert(c.alertaEstacion(60).nivel === "ROJO", "bajó antes de tiempo");
    assert(c.alertaEstacion(60 + 299).nivel === "ROJO", "bajó antes de 5 min");
    assert(c.alertaEstacion(60 + 300).nivel === "VERDE", "no bajó a los 5 min");
  }],

  // ---- Aguacero -------------------------------------------------------------
  ["aguacero: lluvia total plausible y la crecida llega antes aguas arriba", () => {
    const ag = crearAguacero();
    const mm = ag.lluviaTotalMm();
    assert(mm > 30 && mm < 70, `lluvia total ${mm.toFixed(1)} mm`);
    const pico = (id) => { let m = 0, tm = 0; for (let t = 0; t < 3600; t++) if (ag.nivelCm(id, t) > m) { m = ag.nivelCm(id, t); tm = t; } return tm; };
    const tiempos = OJOS_DEMO.map((o) => pico(o.id));
    assert(tiempos.every((t, i) => i === 0 || t > tiempos[i - 1]), `picos fuera de orden: ${tiempos}`);
  }],

  ["aguacero + cerebro: la demo pasa por ROJO y vuelve a VERDE en 60 min", () => {
    const ag = crearAguacero(), f = crearFuenteDemo({ aguacero: ag, cerebro: crearCerebro(), umbrales: UMBRALES });
    const vistos = new Set();
    for (let t = 0; t < 3600; t += 5) vistos.add(f.actualizar(t).nivel);
    assert(vistos.has("ROJO"), `niveles: ${[...vistos]}`);
    assert(f.ultima().nivel === "VERDE", `terminó en ${f.ultima().nivel}`);
  }],

  // ---- Estación ---------------------------------------------------------------
  ["estación: arranca en CAPTURA, boca cerrada, banda en marcha suave", () => {
    const b = banco().run(1500);
    assert(b.st().modo === MODOS.CAPTURA, b.st().modo);
    assert(Math.abs(b.servo().grados - C.cerradaDeg) < 1.5, `compuerta en ${b.servo().grados}`);
    assert(b.st().bandaPwm === CONFIG.banda.normal, `banda ${b.st().bandaPwm}`);
    assert(b.motor().rpm > 50, `motor a ${b.motor().rpm} rpm`);
  }],

  ["estación: AMARILLO acelera la banda", () => {
    const b = banco().run(1000);
    b.alerta = "AMARILLO";
    b.est.setAlerta("AMARILLO");
    b.run(1000);
    assert(b.st().bandaPwm === CONFIG.banda.alta, `banda ${b.st().bandaPwm}`);
  }],

  ["estación: ROJO abre la boca en < 1,2 s, para la banda y ruge", () => {
    const b = banco().run(1500);
    b.alerta = "ROJO";
    b.est.setAlerta("ROJO", "prueba");
    let rugio = false;
    b.run(1200, (b) => { if (b.world.pins[0].value) rugio = true; });
    assert(b.st().modo === MODOS.ALIVIO, b.st().modo);
    assert(b.servo().grados >= C.abiertaDeg - 3, `compuerta solo en ${b.servo().grados.toFixed(1)}°`);
    assert(b.st().bandaPwm === 0 && b.motor().rpm < 20, `banda ${b.st().bandaPwm}, ${b.motor().rpm.toFixed(0)} rpm`);
    assert(rugio, "no rugió");
  }],

  ["estación: al salir de ROJO cierra despacio y luego arranca la banda", () => {
    const b = banco().run(1000);
    b.alerta = "ROJO"; b.est.setAlerta("ROJO"); b.run(2000);
    b.alerta = "NARANJA"; b.est.setAlerta("NARANJA");
    // Velocidad media en ventanas de 250 ms (el servo avanza a pasitos de 50 ms).
    let maxVel = 0, prev = b.servo().grados, ventana = 0, bandaAntesDeCerrar = false;
    b.run(5000, (b) => {
      const g = b.servo().grados;
      if ((ventana += 5) >= 250) { maxVel = Math.max(maxVel, (prev - g) / 0.25); prev = g; ventana = 0; }
      if (g > C.cerradaDeg + 3 && b.st().bandaPwm > 0) bandaAntesDeCerrar = true;
    });
    assert(maxVel <= C.velCierreDegS * 1.3, `cerró a ${maxVel.toFixed(0)}°/s`);
    assert(!bandaAntesDeCerrar, "la banda arrancó con la boca abierta");
    assert(b.st().bandaPwm === CONFIG.banda.alta, `banda ${b.st().bandaPwm}`);
  }],

  ["contador: cuenta cada objeto y descarta rebotes", () => {
    const b = banco().run(1000);
    for (let i = 0; i < 10; i++) b.pulso(150, 350);
    assert(b.st().objetos === 10, `contó ${b.st().objetos}`);
    b.pulso(30, 40); b.pulso(30, 300); // rebote: dos cortes en < 120 ms
    assert(b.st().objetos === 11, `con rebote contó ${b.st().objetos}`);
  }],

  ["contador: ruge al completar cada kilo", () => {
    const b = banco().run(1000);
    const n = Math.ceil(1000 / CONFIG.contador.masaPromedioG);
    for (let i = 0; i < n - 1; i++) b.pulso(100, 200);
    assert(!b.log.some((m) => m.includes("1 kg")), "rugió antes del kilo");
    b.pulso(100, 100);
    assert(b.log.some((m) => m.includes("1 kg")) && b.st().rugiendo, "no rugió al llegar a 1 kg");
  }],

  ["atasco: haz tapado 3 s detiene la banda y se recupera al liberarlo", () => {
    const b = banco().run(1500);
    b.world.setDigital(IR, 0);
    b.run(3500);
    assert(b.st().modo === MODOS.ATASCO && b.st().bandaPwm === 0, `${b.st().modo}, banda ${b.st().bandaPwm}`);
    b.world.setDigital(IR, 1);
    b.run(1500);
    assert(b.st().modo === MODOS.CAPTURA && b.st().bandaPwm > 0, `${b.st().modo}, banda ${b.st().bandaPwm}`);
  }],

  ["atasco persistente: tras 3 intentos la banda queda detenida", () => {
    const b = banco().run(1500);
    b.world.setDigital(IR, 0);
    b.run(40000);
    assert(b.st().modo === MODOS.ATASCO && b.st().atascoIntentos === CONFIG.contador.reintentosAtasco, `${b.st().modo}, intentos ${b.st().atascoIntentos}`);
    assert(b.st().bandaPwm === 0, `banda ${b.st().bandaPwm}`);
  }],

  ["sin datos: ojos azules a los 30 s y boca abierta a los 2 min (falla segura)", () => {
    const b = banco().run(1500);
    b.alerta = null;
    b.run(35000);
    assert(b.st().modo === MODOS.SIN_DATOS && b.st().bandaPwm > 0, `${b.st().modo}`);
    b.run(90000);
    assert(b.st().modo === MODOS.ALIVIO_SIN_DATOS, b.st().modo);
    assert(b.servo().grados >= C.abiertaDeg - 3, `compuerta en ${b.servo().grados.toFixed(1)}`);
    b.alerta = "VERDE";
    b.run(8000);
    assert(b.st().modo === MODOS.CAPTURA, `no se recuperó: ${b.st().modo}`);
  }],

  ["alimentación: banda y servo desde el 5V del Arduino = caída de tensión", () => {
    let caida = false;
    const b = banco({ alimentacion: "arduino5v" });
    b.world.on("brownout", () => (caida = true));
    b.run(2000);
    assert(caida, "esperaba caída de tensión");
  }],

  ["alimentación externa: sin caídas durante un aguacero completo", () => {
    let caida = false;
    const b = banco();
    b.world.on("brownout", () => (caida = true));
    b.alerta = "VERDE"; b.run(2000);
    b.alerta = "ROJO"; b.run(5000);
    b.alerta = "NARANJA"; b.run(8000);
    assert(!caida, "caída de tensión inesperada");
  }],

  ["placa virtual rechaza la tira RGB en un pin sin PWM, como Johnny-Five", () => {
    const five = createVirtualFive(new VirtualWorld());
    let fallo = false;
    try { new five.Led.RGB({ pins: { red: 5, green: 7, blue: 11 } }); } catch { fallo = true; }
    assert(fallo, "debió fallar con D7");
  }],

  ["de punta a punta: 45 min de aguacero con cerebro y estación", () => {
    const ag = crearAguacero(), f = crearFuenteDemo({ aguacero: ag, cerebro: crearCerebro(), umbrales: UMBRALES });
    const b = banco();
    b.alerta = null; // la alerta la pone la demo
    let ultima = -1e9, maxCompuerta = 0;
    b.run(45 * 60 * 1000, (b) => {
      if (!b.est || b.world.time - ultima < 5000) return;
      ultima = b.world.time;
      const a = f.actualizar(b.world.time / 1000);
      b.est.setAlerta(a.nivel, a.motivo);
      maxCompuerta = Math.max(maxCompuerta, b.servo().grados);
    });
    assert(b.modos.has(MODOS.ALIVIO), `modos: ${[...b.modos]}`);
    assert(maxCompuerta >= C.abiertaDeg - 3, `la boca solo abrió a ${maxCompuerta.toFixed(0)}°`);
    assert(b.st().modo === MODOS.CAPTURA, `terminó en ${b.st().modo}`);
  }],
];
