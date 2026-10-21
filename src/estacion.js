// Caimán 1 a escala 1:5 — controlador de la estación ("las fauces").
//
// ESTE ARCHIVO CORRE IGUAL EN LA MAQUETA REAL Y EN EL SIMULADOR.
// Solo habla con el hardware a través de la API de Johnny-Five que recibe:
//   - maqueta real: el paquete `johnny-five` + Arduino Uno por USB
//   - simulador:    sim/virtual-five.js (misma API, con modelo físico)
//
// Lo que usa de Johnny-Five (se mantiene pequeño para que el simulador sea fiel):
//   new five.Servo({ pin, range, startAt }) .to(grados)
//   new five.Motor({ pin })                 .start(0..255) .stop()
//   new five.Led.RGB({ pins })              .color([r, g, b])
//   new five.Pin(pin)                       .high() .low()
//   new five.Button({ pin, isPullup })      eventos "press" / "release"
//   board.loop(ms, fn)
//
// El reloj NO es board.millis(): en johnny-five@2.1.0 devuelve solo la parte de
// nanosegundos de process.hrtime y vuelve a 0 cada segundo. Se usa performance.now()
// (monótono), y el simulador inyecta su reloj simulado con opts.reloj.
//
// La alerta (VERDE/AMARILLO/NARANJA/ROJO) llega de afuera con setAlerta():
// del servidor (GET /alerta) en campo, o de la demo del aguacero en ferias.

import { CONFIG } from "./config.js";
import { NIVELES } from "./cerebro.js";

export const MODOS = Object.freeze({
  CAPTURA: "CAPTURA",       // boca cerrada (rampa abajo), banda andando
  ALIVIO: "ALIVIO",         // ROJO: boca abierta, banda detenida
  ATASCO: "ATASCO",         // algo tapa la barrera IR: banda detenida
  SIN_DATOS: "SIN_DATOS",   // no llega alerta: sigue con la última, ojos azules
  ALIVIO_SIN_DATOS: "ALIVIO_SIN_DATOS", // mucho tiempo sin datos: abre por seguridad
});

const RUGIDOS = Object.freeze({
  largo: [700, 250, 700, 250, 1200], // al pasar a ROJO
  corto: [250],                      // cada kilo de basura
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function crearEstacion(five, board, config = CONFIG, opts = {}) {
  const { pines: P, compuerta: C, banda: B, contador: K, conexion: X, colores } = config;
  const log = opts.log || (() => {});
  const now = opts.reloj || (() => performance.now());
  const marca = () => `[${(now() / 1000).toFixed(1)}s]`;

  // ---- Hardware -----------------------------------------------------------
  const compuerta = new five.Servo({ pin: P.compuerta, range: [C.cerradaDeg, C.abiertaDeg], startAt: C.cerradaDeg });
  const banda = new five.Motor({ pin: P.banda });
  const ojos = new five.Led.RGB({ pins: { red: P.ojoRojo, green: P.ojoVerde, blue: P.ojoAzul } });
  const rugido = new five.Pin(P.rugido);
  const barrera = new five.Button({ pin: P.contadorIR, isPullup: true });

  // ---- Alerta -------------------------------------------------------------
  let alerta = "VERDE";
  let motivo = "arranque";
  let alertaEn = now();

  function setAlerta(nivel, porQue = "") {
    if (!NIVELES.includes(nivel)) { log(`${marca()} alerta desconocida "${nivel}" (ignorada)`); return; }
    alertaEn = now();
    if (nivel === alerta) { motivo = porQue || motivo; return; }
    log(`${marca()} alerta ${alerta} -> ${nivel}${porQue ? ` (${porQue})` : ""}`);
    if (nivel === "ROJO") rugir("largo");
    alerta = nivel;
    motivo = porQue;
  }

  // ---- Rugido (buzzer) sin bloquear el ciclo ------------------------------
  let rugidoPatron = null, rugidoInicio = 0, rugidoPin = false;
  function rugir(tipo) { rugidoPatron = RUGIDOS[tipo]; rugidoInicio = now(); }
  function actualizarRugido(t) {
    let alto = false;
    if (rugidoPatron) {
      let e = t - rugidoInicio, i = 0;
      while (i < rugidoPatron.length && e >= rugidoPatron[i]) e -= rugidoPatron[i++];
      if (i >= rugidoPatron.length) rugidoPatron = null;
      else alto = i % 2 === 0; // segmentos pares = sonando
    }
    if (alto !== rugidoPin) { alto ? rugido.high() : rugido.low(); rugidoPin = alto; }
  }

  // ---- Contador de basura (barrera infrarroja al final de la banda) --------
  let objetos = 0, ultimoCorte = -Infinity, kgAnunciados = 0, cortadoDesde = null;
  barrera.on("press", () => {           // haz cortado
    const t = now();
    cortadoDesde = t;
    if (t - ultimoCorte >= K.antirreboteMs) {
      objetos++;
      const kg = Math.floor((objetos * K.masaPromedioG) / 1000);
      if (kg > kgAnunciados) { kgAnunciados = kg; log(`${marca()} ${kg} kg de basura atrapada`); rugir("corto"); }
    }
    ultimoCorte = t;
  });
  barrera.on("release", () => { cortadoDesde = null; });

  // ---- Actuadores: solo se envía lo que cambia (ahorra el puerto serie) ---
  let compuertaCmd = C.cerradaDeg, compuertaEnviada = NaN;
  const enviarCompuerta = (deg) => {
    const d = Math.round(clamp(deg, C.cerradaDeg, C.abiertaDeg));
    if (d !== compuertaEnviada) { compuerta.to(d); compuertaEnviada = d; }
  };
  let bandaCmd = 0, bandaEnviada = NaN;
  const enviarBanda = (v) => {
    const p = Math.round(clamp(v, 0, 255));
    if (p === bandaEnviada) return;
    p === 0 ? banda.stop() : banda.start(p);
    bandaEnviada = p;
  };
  let colorEnviado = "";
  const enviarOjos = (rgb, f = 1) => {
    const c = rgb.map((v) => Math.round(v * clamp(f, 0, 1)));
    const k = c.join(",");
    if (k !== colorEnviado) { ojos.color(c); colorEnviado = k; }
  };

  // ---- Modo -----------------------------------------------------------------
  let modo = MODOS.CAPTURA;
  let atascoIntentos = 0, atascoDesde = null;

  const cambiarModo = (nuevo, porQue) => {
    if (nuevo === modo) return;
    log(`${marca()} modo ${modo} -> ${nuevo}${porQue ? ` (${porQue})` : ""}`);
    modo = nuevo;
  };

  let apagado = false;

  function tick(cancelar) {
    if (apagado) { cancelar?.(); return; } // tras shutdown() no se vuelve a mandar nada
    const t = now();
    const dt = config.bucleMs / 1000;
    const edadAlerta = t - alertaEn;

    // Atasco: el haz lleva cortado demasiado tiempo con la banda andando.
    const hazTapado = cortadoDesde !== null && t - cortadoDesde >= K.atascoMs;
    if (modo === MODOS.CAPTURA && hazTapado && bandaEnviada > 0) {
      atascoIntentos++;
      atascoDesde = t;
      cambiarModo(MODOS.ATASCO, `barrera IR tapada (intento ${atascoIntentos}/${K.reintentosAtasco})`);
    }
    if (modo === MODOS.ATASCO) {
      if (cortadoDesde === null) {
        atascoIntentos = 0;
        cambiarModo(MODOS.CAPTURA, "barrera libre");
      } else if (atascoIntentos < K.reintentosAtasco && t - atascoDesde >= K.pausaAtascoMs) {
        cortadoDesde = t; // se vuelve a contar desde el reintento
        cambiarModo(MODOS.CAPTURA, "reintento");
      }
    }

    // Prioridades: ROJO y la falla segura por falta de datos mandan sobre todo.
    if (alerta === "ROJO") cambiarModo(MODOS.ALIVIO, "alerta ROJA");
    else if (edadAlerta > X.abrirSinDatosMs) cambiarModo(MODOS.ALIVIO_SIN_DATOS, "sin datos del cerebro");
    else if (modo === MODOS.ATASCO) { /* se queda */ }
    else if (edadAlerta > X.sinDatosMs) cambiarModo(MODOS.SIN_DATOS, "no llega la alerta");
    else cambiarModo(MODOS.CAPTURA, `alerta ${alerta}`);

    const abierta = modo === MODOS.ALIVIO || modo === MODOS.ALIVIO_SIN_DATOS;

    // Compuerta: abrir a toda velocidad; cerrar despacio.
    if (abierta) compuertaCmd = C.abiertaDeg;
    else compuertaCmd = Math.max(C.cerradaDeg, compuertaCmd - C.velCierreDegS * dt);

    // Banda: parada si la boca está abierta o atascada; arranque suave.
    const andar = modo === MODOS.CAPTURA || modo === MODOS.SIN_DATOS;
    const objetivo = andar && compuertaCmd <= C.cerradaDeg + 1 ? (alerta === "VERDE" ? B.normal : B.alta) : 0;
    if (objetivo === 0) bandaCmd = 0;
    else bandaCmd = Math.min(objetivo, bandaCmd + (255 / B.arranqueMs) * config.bucleMs);
    if (bandaCmd < objetivo && bandaCmd > objetivo - 1) bandaCmd = objetivo;

    // Ojos: color de la alerta y patrón según el modo.
    const parpadeo = (hz) => (Math.floor((t / 1000) * hz * 2) % 2 === 0 ? 1 : 0.08);
    if (modo === MODOS.ATASCO) enviarOjos(colores.ATASCO, parpadeo(2));
    else if (modo === MODOS.SIN_DATOS || modo === MODOS.ALIVIO_SIN_DATOS)
      enviarOjos(Math.floor(t / 1000) % 2 ? colores.SIN_DATOS : colores[alerta]);
    else if (alerta === "ROJO") enviarOjos(colores.ROJO, parpadeo(3));
    else if (alerta === "NARANJA") enviarOjos(colores.NARANJA, parpadeo(1));
    else if (alerta === "AMARILLO") enviarOjos(colores.AMARILLO);
    else enviarOjos(colores.VERDE, 0.3 + 0.7 * (0.5 - 0.5 * Math.cos((t / 3000) * 2 * Math.PI)));

    actualizarRugido(t);
    enviarCompuerta(compuertaCmd);
    enviarBanda(bandaCmd);
  }

  // Estado inicial seguro: boca cerrada, banda quieta, ojos verdes tenues.
  enviarCompuerta(C.cerradaDeg);
  enviarBanda(0);
  enviarOjos(colores.VERDE, 0.3);
  board.loop(config.bucleMs, tick);
  log(`${marca()} Caimán 1 (escala 1:5) en línea: compuerta D${P.compuerta}, banda D${P.banda}, ojos D${P.ojoRojo}/D${P.ojoVerde}/D${P.ojoAzul}, rugido D${P.rugido}, barrera IR D${P.contadorIR}`);

  return {
    setAlerta,
    status: () => ({
      modo, alerta, motivo,
      edadAlertaS: (now() - alertaEn) / 1000,
      compuertaDeg: compuertaEnviada,
      bandaPwm: bandaEnviada,
      objetos,
      kg: (objetos * K.masaPromedioG) / 1000,
      atascoIntentos,
      rugiendo: rugidoPin,
      ojos: colorEnviado,
    }),
    // Al salir: banda quieta, boca ABIERTA (falla segura: nunca dejar
    // la compuerta cerrada frente a una creciente) y todo apagado.
    shutdown() {
      apagado = true;
      banda.stop();
      compuerta.to(C.abiertaDeg);
      ojos.color([0, 0, 0]);
      rugido.low();
    },
  };
}
