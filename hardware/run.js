// Caimán 1 a escala 1:5 en la maqueta real (Arduino Uno + StandardFirmata por USB).
//
//   npm run maqueta -- --servidor http://localhost:8000
//       consulta GET /alerta del servidor ("cerebro") cada 5 s
//       (si el servidor pide clave: CAIMAN_TOKEN=... se manda como "Authorization: Bearer")
//   npm run demo
//       feria sin internet: 30 min de lluvia + 30 de bajada simulados en el portátil
//   npm run demo -- --rapido 20
//       el mismo aguacero en 3 min
//   npm run demo -- --sin-placa
//       todo simulado (sin Arduino), para probar en cualquier portátil
//
// CAIMAN_PORT=/dev/tty.usbmodemXXXX (o COM3 en Windows) elige el puerto si la detección falla.
// Requiere Node.js 20.14 o más nuevo y StandardFirmata cargado en el Uno.

import { crearEstacion } from "../src/estacion.js";
import { OJO_CAIMAN } from "../src/aguacero.js";
import { crearDemo, mmss } from "../src/demo.js";
import { CONFIG } from "../src/config.js";

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const servidor = opcion("--servidor");
const rapido = Math.max(1, Number(opcion("--rapido")) || 1);
const sinPlaca = args.includes("--sin-placa");
const reportar = args.includes("--reportar");

// "--servidor" sin URL NO puede caer en silencio en la demo: la maqueta obedecería un aguacero falso.
if (args.includes("--servidor") && !/^https?:\/\//i.test(servidor ?? "")) {
  console.error("✖ --servidor necesita una URL, por ejemplo: npm run maqueta -- --servidor http://localhost:8000");
  process.exit(1);
}

let five, board, reloj;
if (sinPlaca) {
  const { VirtualWorld, createVirtualFive } = await import("../sim/virtual-five.js");
  const world = new VirtualWorld();
  five = createVirtualFive(world);
  board = new five.Board();
  reloj = () => world.time;
  setInterval(() => world.step(20), 20); // el mundo virtual corre en tiempo real
  console.log("Modo --sin-placa: hardware virtual (sim/virtual-five.js)");
} else {
  five = (await import("johnny-five")).default;
  board = await (await import("./conectar.js")).conectarPlaca();
}

board.on("ready", () => {
  const est = crearEstacion(five, board, CONFIG, { log: console.log, reloj });
  if (servidor) consultarServidor(est);
  else demoAguacero(est);

  // Al salir: boca abierta (falla segura) y banda quieta. Con la placa real,
  // Johnny-Five atrapa Ctrl+C, emite "exit" y espera a que salgan los últimos
  // mensajes por el puerto antes de cerrar. Lo demás (kill, errores) se cubre aquí.
  let cerrando = false;
  const salirSeguro = (motivo, codigo) => {
    if (cerrando) return;
    cerrando = true;
    if (motivo) console.error(motivo);
    try { est.shutdown(); } catch { /* el puerto puede estar caído */ }
    setTimeout(() => process.exit(codigo), 400);
  };
  board.on("exit", () => { cerrando = true; est.shutdown(); });
  process.on("SIGTERM", () => salirSeguro("Señal de cierre: boca abierta y banda detenida.", 0));
  process.on("uncaughtException", (e) => salirSeguro(`✖ Error inesperado: ${e.message}. Boca abierta y banda detenida.`, 1));
  if (sinPlaca) process.on("SIGINT", () => salirSeguro("", 0));
});

board.on("error", (err) => {
  console.error(`✖ Error de la placa: ${err.message}`);
  process.exit(1);
});
// Se cayó el USB o se reinició el Uno: desde aquí ya no se puede mover nada.
for (const ev of ["close", "disconnect"]) {
  board.on(ev, () => {
    console.error("✖ Se perdió la conexión con el Arduino. La maqueta quedó en su último estado:");
    console.error("  revise el cable USB y la alimentación, y vuelva a iniciar.");
    process.exit(1);
  });
}

// Texto del servidor sin caracteres de control (no se deja escribir secuencias en la terminal).
const limpio = (s) => String(s ?? "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200);

// ---- Campo: el servidor de alertas decide ----------------------------------------
// Espera de GET /alerta un JSON como { "nivel": "NARANJA", "motivo": "..." }.
// Campos opcionales que la estación respeta si el servidor los manda:
//   "sinDatos": true      el servidor no tiene ojos vivos
//   "ojosVivos": 0        cuántos ojos reportan
//   "t": 1729600000000    hora de la alerta (ms); si tiene más de 30 s, se descarta
// En esos casos NO se renueva la alerta: la estación pasa sola a SIN_DATOS y luego abre la boca.
function consultarServidor(est) {
  const base = servidor.replace(/\/$/, "");
  const headers = process.env.CAIMAN_TOKEN ? { authorization: `Bearer ${process.env.CAIMAN_TOKEN}` } : {};
  let fallando = false;
  console.log(`Consultando ${base}/alerta cada 5 s`);
  const consultar = async () => {
    try {
      const r = await fetch(`${base}/alerta`, { headers, signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const a = await r.json();
      if (!a || typeof a !== "object") throw new Error("respuesta que no es un objeto JSON");
      if (a.sinDatos === true || a.ojosVivos === 0) throw new Error("el servidor no tiene datos de los ojos");
      if (Number.isFinite(a.t) && Date.now() - a.t > 30000) throw new Error("alerta vieja (más de 30 s)");
      est.setAlerta(limpio(a.nivel ?? a.alerta), limpio(a.motivo));
      if (fallando) { console.log("Servidor de alertas de vuelta"); fallando = false; }
    } catch (e) {
      if (!fallando) console.log(`Sin alerta válida de ${base}/alerta (${limpio(e.message)})`);
      fallando = true;
    }
  };
  consultar(); // la primera, ya: tras un reinicio no hay que esperar 5 s
  setInterval(consultar, 5000);

  if (reportar) {
    // Propuesta: el servidor aún no tiene este endpoint de escritura (la
    // especificación solo define GET /estacion/basura). Ajustar al implementarlo.
    setInterval(async () => {
      const { objetos, kg } = est.status();
      try {
        await fetch(`${base}/estacion/basura`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ objetos, kg }),
          signal: AbortSignal.timeout(3000),
        });
      } catch { /* se reintenta en el siguiente envío */ }
    }, 60000);
  }
}

// ---- Feria: aguacero simulado en el portátil, sin internet -------------------------
// La misma demo que usa el simulador (src/demo.js).
function demoAguacero(est) {
  const demo = crearDemo({ cadaS: 0 }); // consulta en cada vuelta del intervalo
  let t0 = Date.now(), ultimoResumen = -Infinity;
  const anunciar = () => console.log(`Aguacero de demostración: 30 min de lluvia + 30 de bajada${rapido > 1 ? ` a ×${rapido} (${(demo.totalS / rapido).toFixed(0)} s)` : ""}`);
  anunciar();
  const coma = (v, d = 1) => v.toFixed(d).replace(".", ",");
  setInterval(() => {
    const tS = ((Date.now() - t0) / 1000) * rapido;
    if (tS > demo.totalS) {
      console.log("Fin de la demostración (30 min de lluvia y 30 de bajada). Empieza otro aguacero.");
      demo.reiniciar(); t0 = Date.now(); ultimoResumen = -Infinity; anunciar();
      return;
    }
    const a = demo.tick(tS, est);
    if (tS - ultimoResumen >= 30) {
      ultimoResumen = tS;
      const st = est.status();
      console.log(`[aguacero ${mmss(tS)}] lluvia ${coma(demo.ag.lluviaMmMin(tS))} mm/min · nivel ${demo.ag.nivelCm(OJO_CAIMAN, tS).toFixed(0)} cm · alerta ${a.nivel} · ${st.modo} · ${st.objetos} objetos`);
    }
  }, Math.max(250, 5000 / rapido));
}
