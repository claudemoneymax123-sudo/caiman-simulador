// Pruebas del cerebro, del aguacero y de la estación sobre el hardware virtual.
// Corren en Node (`npm test`) y en el navegador (test/index.html).

import { crearEstacion, MODOS } from "../src/estacion.js";
import { crearCerebro, NIVELES } from "../src/cerebro.js";
import { crearAguacero, crearFuenteDemo, OJOS_DEMO, velocidadFlujo } from "../src/aguacero.js";
import { CONFIG, UMBRALES } from "../src/config.js";
import { VirtualWorld, createVirtualFive, mulberry32 } from "../sim/virtual-five.js";
import { crearRio, CANAL } from "../sim/rio.js";
import { crearDemo, mmss } from "../src/demo.js";

const C = CONFIG.compuerta, IR = CONFIG.pines.contadorIR, X = CONFIG.conexion;
// La estación arranca con la boca abierta y la cierra a velCierreDegS; luego arranca la banda.
const LISTO_MS = Math.ceil(((C.abiertaDeg - C.cerradaDeg) / C.velCierreDegS) * 1000 + CONFIG.banda.arranqueMs + 900);
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Banco de pruebas: estación sobre hardware virtual. `alerta` se reenvía cada 5 s
// (como si el servidor respondiera GET /alerta); null = no llega nada.
function banco(worldOpts = {}, antes) {
  const world = new VirtualWorld({ seed: 42, ...worldOpts });
  antes?.(world);
  const five = createVirtualFive(world);
  const board = new five.Board();
  const b = { world, board, est: null, log: [], alerta: "VERDE", modos: new Set() };
  board.on("error", () => {});
  board.on("close", () => {});
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
  b.listo = () => b.run(LISTO_MS);
  b.st = () => b.est.status();
  b.servo = () => world.servos[0];
  b.motor = () => world.motores[0];
  b.rugidoPin = () => world.pins.find((p) => p.pin === CONFIG.pines.rugido);
  b.pulso = (msCortado, msLibre = 300) => { world.setDigital(IR, 0); b.run(msCortado); world.setDigital(IR, 1); b.run(msLibre); };
  return b;
}

// Cerebro con lecturas de un ojo cada 60 s (para que no caduquen).
function alimentar(c, id, desde, hasta, nivelCm, lluviaMm = 0) {
  for (let t = desde; t <= hasta; t += 60) c.agregarLectura({ id, t, nivelCm: typeof nivelCm === "function" ? nivelCm(t) : nivelCm, lluviaMm });
}
const todosLosOjos = (c, desde, hasta, nivelCm = 20) => UMBRALES.ojos.forEach((o) => alimentar(c, o.id, desde, hasta, nivelCm));

export const tests = [
  // ---- Cerebro --------------------------------------------------------------
  ["cerebro: sin lecturas NO es VERDE: la estación recibe 'sin datos'", () => {
    const a = crearCerebro().alertaEstacion(0);
    assert(a.sinDatos === true && a.ojosSinDatos === UMBRALES.ojos.length, JSON.stringify(a));
  }],

  ["cerebro: lluvia fuerte en 10 min = AMARILLO", () => {
    const c = crearCerebro();
    todosLosOjos(c, 0, 300);
    alimentar(c, 1, 0, 300, 10, 2);
    const a = c.alertaEstacion(300);
    assert(a.nivel === "AMARILLO", `${a.nivel} (${a.motivo})`);
  }],

  ["cerebro: el nivel sube rápido = NARANJA", () => {
    const c = crearCerebro();
    todosLosOjos(c, 0, 180);
    [10, 15, 25, 35].forEach((n, i) => c.agregarLectura({ id: 2, t: i * 60, nivelCm: n }));
    const a = c.alertaEstacion(180);
    assert(a.nivel === "NARANJA", `${a.nivel} (${a.motivo})`);
  }],

  ["cerebro: sobre la cota de desborde = ROJO", () => {
    const c = crearCerebro();
    c.agregarLectura({ id: 5, t: 0, nivelCm: UMBRALES.ojos[4].cotaDesbordeCm + 1 });
    assert(c.alertaEstacion(0).nivel === "ROJO", "debería ser ROJO");
  }],

  ["cerebro: la alerta sube de inmediato y baja un escalón cada 5 min", () => {
    const c = crearCerebro(), paso = UMBRALES.bajarTrasMin * 60;
    todosLosOjos(c, 0, 4000);
    c.agregarLectura({ id: 5, t: 0, nivelCm: 200 });
    assert(c.alertaEstacion(0).nivel === "ROJO", "no subió");
    c.agregarLectura({ id: 5, t: 60, nivelCm: 20 });
    const en = (t) => c.alertaEstacion(t).nivel;
    assert(en(60) === "ROJO" && en(60 + paso - 1) === "ROJO", "bajó antes de tiempo");
    assert(en(60 + paso) === "NARANJA", `a los 5 min: ${en(60 + paso)}`);
    assert(en(60 + 2 * paso) === "AMARILLO", `a los 10 min: ${en(60 + 2 * paso)}`);
    assert(en(60 + 3 * paso) === "VERDE", `a los 15 min: ${en(60 + 3 * paso)}`);
  }],

  ["cerebro: un ROJO viejo caduca (el ojo pasa a 'sin datos')", () => {
    const c = crearCerebro();
    c.agregarLectura({ id: 5, t: 0, nivelCm: 200 });
    const a = c.alertaOjo(5, UMBRALES.ojoSinDatosS + 1);
    assert(a.sinDatos === true, JSON.stringify(a));
    assert(c.alertaEstacion(UMBRALES.ojoSinDatosS + 1).sinDatos === true, "con todos los ojos caducados la estación debe quedar sin datos");
  }],

  ["cerebro: descarta lecturas que no son números", () => {
    const c = crearCerebro();
    assert(c.agregarLectura({ id: 1, t: 0, nivelCm: NaN }) === false, "aceptó NaN");
    assert(c.agregarLectura({ id: 1, t: 0, nivelCm: null }) === false, "aceptó null");
    assert(c.descartadas.get(1) === 2, `descartadas: ${c.descartadas.get(1)}`);
  }],

  ["cerebro: el color de un ojo no parpadea en la cota con ruido de ±5 mm", () => {
    const c = crearCerebro(), cota = UMBRALES.ojos[0].cotaDesbordeCm;
    todosLosOjos(c, 0, 1800);
    let cambios = 0, previo = null;
    for (let t = 0; t <= 1800; t += 15) {
      c.agregarLectura({ id: 1, t, nivelCm: cota + (t % 30 ? 0.5 : -0.5) });
      const n = c.alertaEstacion(t).porOjo[0].nivel;
      if (previo && n !== previo) cambios++;
      previo = n;
    }
    assert(cambios <= 1, `el ojo 1 cambió ${cambios} veces`);
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

  ["aguacero + cerebro: VERDE → AMARILLO → NARANJA → ROJO y baja escalón por escalón", () => {
    const ag = crearAguacero(), f = crearFuenteDemo({ aguacero: ag, cerebro: crearCerebro(), umbrales: UMBRALES });
    const secuencia = [];
    for (let t = 0; t < 3600; t += 5) { const n = f.actualizar(t).nivel; if (secuencia.at(-1) !== n) secuencia.push(n); }
    const esperada = ["VERDE", "AMARILLO", "NARANJA", "ROJO", "NARANJA", "AMARILLO", "VERDE"];
    assert(secuencia.join(">") === esperada.join(">"), `secuencia: ${secuencia.join(" > ")}`);
  }],

  ["aguacero: un ojo apagado se marca 'sin datos' y los demás siguen avisando", () => {
    const ag = crearAguacero(), f = crearFuenteDemo({ aguacero: ag, cerebro: crearCerebro(), umbrales: UMBRALES });
    f.apagarOjo(4);
    let a;
    for (let t = 0; t <= 1200; t += 5) a = f.actualizar(t);
    assert(a.porOjo[3].sinDatos === true && a.ojosSinDatos === 1, JSON.stringify(a.porOjo[3]));
    assert(NIVELES.indexOf(a.nivel) >= 2, `con 4 ojos la alerta debería ser al menos NARANJA: ${a.nivel}`);
  }],

  ["agua: velocidad de Manning crece con el nivel y es plausible", () => {
    const v1 = velocidadFlujo(0.15), v2 = velocidadFlujo(1.0), v3 = velocidadFlujo(1.8);
    assert(v1 < v2 && v2 < v3, `${v1} ${v2} ${v3}`);
    assert(v3 > 2.5 && v3 < 6, `con 1,8 m de agua: ${v3.toFixed(2)} m/s`);
  }],

  // ---- Estación ---------------------------------------------------------------
  ["estación: arranca con la boca abierta, la cierra despacio y luego arranca la banda", () => {
    const b = banco();
    let maxVel = 0, prev = null, ventana = 0, bandaConBocaAbierta = false;
    b.run(LISTO_MS, (b) => {
      if (!b.servo()) return;
      const g = b.servo().grados;
      if (prev === null) prev = g;
      if ((ventana += 5) >= 250) { maxVel = Math.max(maxVel, (prev - g) / 0.25); prev = g; ventana = 0; }
      if (g > C.cerradaDeg + 3 && b.st().bandaPwm > 0) bandaConBocaAbierta = true;
    });
    assert(b.st().modo === MODOS.CAPTURA, b.st().modo);
    assert(Math.abs(b.servo().grados - C.cerradaDeg) < 1.5, `compuerta en ${b.servo().grados}`);
    assert(maxVel <= C.velCierreDegS * 1.3, `cerró a ${maxVel.toFixed(0)}°/s`);
    assert(!bandaConBocaAbierta, "la banda arrancó con la boca abierta");
    assert(b.st().bandaPwm === CONFIG.banda.normal && b.motor().rpm > 50, `banda ${b.st().bandaPwm}, ${b.motor().rpm.toFixed(0)} rpm`);
  }],

  ["estación: AMARILLO acelera la banda", () => {
    const b = banco().listo();
    b.alerta = "AMARILLO";
    b.est.setAlerta("AMARILLO");
    b.run(1000);
    assert(b.st().bandaPwm === CONFIG.banda.alta, `banda ${b.st().bandaPwm}`);
  }],

  ["estación: ROJO abre la boca en < 1,2 s, para la banda y ruge", () => {
    const b = banco().listo();
    b.alerta = "ROJO";
    b.est.setAlerta("ROJO", "prueba");
    let rugio = false;
    b.run(1200, (b) => { if (b.rugidoPin().value) rugio = true; });
    assert(b.st().modo === MODOS.ALIVIO, b.st().modo);
    assert(b.servo().grados >= C.abiertaDeg - 3, `compuerta solo en ${b.servo().grados.toFixed(1)}°`);
    assert(b.st().bandaPwm === 0 && b.motor().rpm < 20, `banda ${b.st().bandaPwm}, ${b.motor().rpm.toFixed(0)} rpm`);
    assert(rugio, "no rugió");
  }],

  ["estación: acepta la alerta en minúsculas o con espacios", () => {
    const b = banco().listo();
    b.alerta = "rojo ";
    b.run(5200);
    assert(b.st().alerta === "ROJO" && b.st().modo === MODOS.ALIVIO, `${b.st().alerta} / ${b.st().modo}`);
  }],

  ["estación: al salir de ROJO cierra despacio y luego arranca la banda", () => {
    const b = banco().listo();
    b.alerta = "ROJO"; b.est.setAlerta("ROJO"); b.run(2000);
    b.alerta = "NARANJA"; b.est.setAlerta("NARANJA");
    let maxVel = 0, prev = b.servo().grados, ventana = 0, bandaAntesDeCerrar = false;
    b.run(LISTO_MS, (b) => {
      const g = b.servo().grados;
      if ((ventana += 5) >= 250) { maxVel = Math.max(maxVel, (prev - g) / 0.25); prev = g; ventana = 0; }
      if (g > C.cerradaDeg + 3 && b.st().bandaPwm > 0) bandaAntesDeCerrar = true;
    });
    assert(maxVel <= C.velCierreDegS * 1.3, `cerró a ${maxVel.toFixed(0)}°/s`);
    assert(!bandaAntesDeCerrar, "la banda arrancó con la boca abierta");
    assert(b.st().bandaPwm === CONFIG.banda.alta, `banda ${b.st().bandaPwm}`);
  }],

  ["contador: cuenta cada objeto y une los rebotes (ventana deslizante)", () => {
    const b = banco().listo();
    for (let i = 0; i < 10; i++) b.pulso(150, 350);
    assert(b.st().objetos === 10, `contó ${b.st().objetos}`);
    b.pulso(30, 40); b.pulso(30, 300); // rebote: dos cortes en < 120 ms
    assert(b.st().objetos === 11, `con rebote contó ${b.st().objetos}`);
  }],

  ["contador: ruge al completar cada kilo", () => {
    const b = banco().listo();
    const n = Math.ceil(1000 / CONFIG.contador.masaPromedioG);
    for (let i = 0; i < n - 1; i++) b.pulso(100, 200);
    assert(!b.log.some((m) => m.includes("1 kg")), "rugió antes del kilo");
    b.pulso(100, 100);
    assert(b.log.some((m) => m.includes("1 kg")) && b.st().rugiendo, "no rugió al llegar a 1 kg");
  }],

  ["rugido: el aviso de ROJO no se corta por el rugido de un kilo", () => {
    const b = banco().listo();
    const n = Math.ceil(1000 / CONFIG.contador.masaPromedioG);
    for (let i = 0; i < n - 1; i++) b.pulso(100, 200);
    b.alerta = "ROJO"; b.est.setAlerta("ROJO");
    b.run(100);
    b.world.setDigital(IR, 0); b.run(100); b.world.setDigital(IR, 1); // el kilo llega durante el rugido largo
    let altoMs = 0;
    b.run(3200, (b) => { if (b.rugidoPin().value) altoMs += 5; });
    assert(altoMs >= 2000, `el rugido largo sonó solo ${altoMs} ms`);
  }],

  ["atasco: haz tapado 3 s detiene la banda y se recupera al liberarlo", () => {
    const b = banco().listo();
    b.world.setDigital(IR, 0);
    b.run(3500);
    assert(b.st().modo === MODOS.ATASCO && b.st().bandaPwm === 0, `${b.st().modo}, banda ${b.st().bandaPwm}`);
    b.world.setDigital(IR, 1);
    b.run(1500);
    assert(b.st().modo === MODOS.CAPTURA && b.st().bandaPwm > 0, `${b.st().modo}, banda ${b.st().bandaPwm}`);
  }],

  ["atasco persistente: tras 3 intentos la banda queda detenida y ruge", () => {
    const b = banco().listo();
    b.world.setDigital(IR, 0);
    b.run(40000);
    assert(b.st().modo === MODOS.ATASCO && b.st().atascoDefinitivo, `${b.st().modo}, intentos ${b.st().atascoIntentos}`);
    assert(b.st().bandaPwm === 0, `banda ${b.st().bandaPwm}`);
  }],

  ["atasco: también se detecta cuando no llegan datos del cerebro", () => {
    const b = banco().listo();
    b.alerta = null;
    b.run(X.sinDatosMs + 2000);
    assert(b.st().modo === MODOS.SIN_DATOS && b.st().bandaPwm > 0, b.st().modo);
    b.world.setDigital(IR, 0);
    b.run(3600);
    assert(b.st().modo === MODOS.ATASCO && b.st().bandaPwm === 0, `${b.st().modo}, banda ${b.st().bandaPwm}`);
  }],

  ["atasco: tras un ROJO con el haz tapado, la banda tiene 3 s antes de declarar atasco", () => {
    const b = banco().listo();
    b.world.setDigital(IR, 0);
    b.alerta = "ROJO"; b.est.setAlerta("ROJO");
    b.run(20000);
    b.alerta = "NARANJA"; b.est.setAlerta("NARANJA");
    b.run(LISTO_MS);
    assert(b.st().modo === MODOS.CAPTURA || b.st().atascoIntentos <= 1, `${b.st().modo}, intentos ${b.st().atascoIntentos}`);
    assert(!b.log.some((m) => /intento [4-9]/.test(m)), "contó un intento de más");
  }],

  ["barrera: si el haz está tapado al encender, también se detecta (como johnny-five)", () => {
    const b = banco({}, (world) => world.setDigital(IR, 0));
    b.run(LISTO_MS + 3500);
    assert(b.st().modo === MODOS.ATASCO, `modo ${b.st().modo}, banda ${b.st().bandaPwm}`);
  }],

  ["sin datos: ojos azules a los 30 s y boca abierta a los 2 min (falla segura)", () => {
    const b = banco().listo();
    b.alerta = null;
    b.run(X.sinDatosMs + 5000);
    assert(b.st().modo === MODOS.SIN_DATOS && b.st().bandaPwm > 0, `${b.st().modo}`);
    let verde = false, rugio = false;
    b.run(X.abrirSinDatosMs - X.sinDatosMs + 5000, (b) => {
      if (b.st().modo === MODOS.ALIVIO_SIN_DATOS) {
        const [r, g, bl] = b.world.leds[0].rgb;
        if (g > bl && g > r) verde = true;
        if (b.rugidoPin().value) rugio = true;
      }
    });
    assert(b.st().modo === MODOS.ALIVIO_SIN_DATOS, b.st().modo);
    assert(b.servo().grados >= C.abiertaDeg - 3, `compuerta en ${b.servo().grados.toFixed(1)}`);
    assert(!verde, "los ojos mostraron verde con la boca abierta por seguridad");
    assert(rugio, "no rugió al abrir por falta de datos");
    b.alerta = "VERDE";
    b.run(8000);
    assert(b.st().modo === MODOS.CAPTURA, `no se recuperó: ${b.st().modo}`);
  }],

  ["alimentación: banda y servo desde el 5V del Arduino = caída de tensión", () => {
    let caida = false;
    const b = banco({ alimentacion: "arduino5v" });
    b.world.on("brownout", () => (caida = true));
    b.run(4000);
    assert(caida, "esperaba caída de tensión");
  }],

  ["alimentación externa: sin caídas durante un aguacero completo", () => {
    let caida = false;
    const b = banco();
    b.world.on("brownout", () => (caida = true));
    b.listo();
    b.alerta = "ROJO"; b.run(5000);
    b.alerta = "NARANJA"; b.run(8000);
    assert(!caida, "caída de tensión inesperada");
  }],

  ["falla segura mecánica: sin corriente, el contrapeso abre la rampa", () => {
    const b = banco().listo();
    for (const s of b.world.servos) s.flojo = true;
    b.run(5000);
    assert(b.servo().grados >= C.abiertaDeg, `la rampa quedó en ${b.servo().grados.toFixed(1)}°`);
  }],

  ["placa virtual: umbral de johnny-five (velocidad < 30 = motor quieto)", () => {
    const five = createVirtualFive(new VirtualWorld());
    const m = new five.Motor({ pin: 3 });
    m.start(20);
    assert(m.pwm === 0, `pwm ${m.pwm}`);
    m.start(40);
    assert(m.pwm === 40, `pwm ${m.pwm}`);
  }],

  ["placa virtual rechaza la tira RGB en un pin sin PWM, como Johnny-Five", () => {
    const five = createVirtualFive(new VirtualWorld());
    let fallo = false;
    try { new five.Led.RGB({ pins: { red: 5, green: 7, blue: 11 } }); } catch { fallo = true; }
    assert(fallo, "debió fallar con D7");
  }],

  // ---- Río y basura (sim/rio.js, física pura) --------------------------------------
  ["río: con la rampa sumergida y la banda andando, la basura llega a la panza", () => {
    const rio = crearRio({ rng: mulberry32(1) });
    const nivelM = 0.6, aguaY = CANAL.fondoY + nivelM, velFlujo = velocidadFlujo(nivelM);
    for (let i = 0; i < 20; i++) rio.soltar(nivelM);
    let tapado = false;
    for (let t = 0; t < 120; t += 0.05) {
      const r = rio.paso(0.05, { rampaDeg: C.cerradaDeg - 45, aguaY, vBanda: 0.4, velFlujo, nivelM, t });
      if (r.hazTapado) tapado = true;
      rio.tomarRemovidos();
    }
    const c = rio.cuenta;
    assert(c.atrapadas > 0, `atrapadas ${c.atrapadas}, escapadas ${c.escapadas}`);
    assert(tapado, "la basura en la banda nunca tapó el haz IR");
    assert(Object.values(c.porTipo).reduce((a, b) => a + b, 0) === c.atrapadas, JSON.stringify(c.porTipo));
    assert(rio.panzaKg > 0, `panza ${rio.panzaKg} kg`);
  }],

  ["río: con la boca levantada, la basura pasa por debajo", () => {
    const rio = crearRio({ rng: mulberry32(2) });
    const nivelM = 1.6, aguaY = CANAL.fondoY + nivelM, velFlujo = velocidadFlujo(nivelM);
    for (let i = 0; i < 20; i++) rio.soltar(nivelM);
    for (let t = 0; t < 120; t += 0.05) rio.paso(0.05, { rampaDeg: C.abiertaDeg - 45, aguaY, vBanda: 0, velFlujo, nivelM, t });
    assert(rio.cuenta.atrapadas === 0, `atrapó ${rio.cuenta.atrapadas} con la boca arriba`);
    assert(rio.cuenta.escapadas === 20, `escaparon ${rio.cuenta.escapadas} de 20`);
  }],

  ["río: el conteo se conserva (soltadas = atrapadas + escapadas + descartadas + en tránsito)", () => {
    const rnd = mulberry32(3);
    const rio = crearRio({ rng: rnd, maxBasura: 10, capacidadBoca: 8 });
    const nivelM = 0.8, aguaY = CANAL.fondoY + nivelM, velFlujo = velocidadFlujo(nivelM);
    for (let t = 0; t < 600; t += 0.05) {
      if (rnd() < 0.02) rio.soltar(nivelM); // ~0,4 objetos por segundo
      const fase = Math.floor(t / 40) % 3; // boca abajo con banda, boca abajo sin banda, boca arriba
      rio.paso(0.05, { rampaDeg: (fase === 2 ? C.abiertaDeg : C.cerradaDeg) - 45, aguaY, vBanda: fase === 0 ? 0.4 : 0, velFlujo, nivelM, t });
      const c = rio.cuenta;
      const suma = c.atrapadas + c.escapadas + c.descartadas + rio.enTransito();
      assert(c.soltadas === suma, `t=${t.toFixed(1)}: ${c.soltadas} soltadas ≠ ${suma} (${JSON.stringify(c)})`);
    }
    const c = rio.cuenta;
    assert(c.atrapadas > 0 && c.escapadas > 0 && c.descartadas > 0, JSON.stringify(c));
  }],

  // ---- Demo compartida (src/demo.js) ------------------------------------------------
  ["demo compartida: consulta cada 5 s y no renueva la alerta sin conexión o sin datos", () => {
    const demo = crearDemo();
    const llamadas = [];
    const est = { setAlerta: (n) => llamadas.push(n) };
    assert(demo.tick(0, est) !== null && llamadas.length === 1, "la primera consulta debe ser inmediata");
    assert(demo.tick(2, est) === null && llamadas.length === 1, "consultó antes de 5 s");
    assert(demo.tick(5, est) !== null && llamadas.length === 2, "no consultó a los 5 s");
    demo.tick(10, est, { conectado: false });
    assert(llamadas.length === 2, "renovó la alerta sin conexión");
    for (const o of UMBRALES.ojos) demo.fuente.apagarOjo(o.id);
    let a;
    for (let t = 15; t <= 15 + UMBRALES.ojoSinDatosS + 60; t += 5) a = demo.tick(t, est);
    const antes = llamadas.length;
    demo.tick(1000, est);
    assert(a.sinDatos && llamadas.length === antes, "renovó la alerta sin datos de ningún ojo");
    assert(mmss(125) === "02:05", mmss(125));
  }],

  ["demo compartida: mantiene la secuencia VERDE → AMARILLO → NARANJA → ROJO → … → VERDE", () => {
    const demo = crearDemo(), secuencia = [];
    for (let t = 0; t < demo.totalS; t += 1) { const a = demo.tick(t, null); if (a && secuencia.at(-1) !== a.nivel) secuencia.push(a.nivel); }
    const esperada = ["VERDE", "AMARILLO", "NARANJA", "ROJO", "NARANJA", "AMARILLO", "VERDE"];
    assert(secuencia.join(">") === esperada.join(">"), secuencia.join(" > "));
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
      if (!a.sinDatos) b.est.setAlerta(a.nivel, a.motivo);
      if (b.world.time > LISTO_MS) maxCompuerta = Math.max(maxCompuerta, b.servo().grados);
    });
    assert(b.modos.has(MODOS.ALIVIO), `modos: ${[...b.modos]}`);
    assert(maxCompuerta >= C.abiertaDeg - 3, `la boca solo abrió a ${maxCompuerta.toFixed(0)}°`);
    assert(b.st().modo === MODOS.CAPTURA, `terminó en ${b.st().modo}`);
  }],
];
