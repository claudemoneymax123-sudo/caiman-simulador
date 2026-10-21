// Caimán 1 a escala 1:5 en la maqueta real (Arduino Uno + StandardFirmata por USB).
//
//   npm run maqueta -- --servidor http://localhost:8000
//       consulta GET /alerta del servidor ("cerebro") cada 5 s
//   npm run demo
//       feria sin internet: aguacero de 30 min simulado en el portátil
//   npm run demo -- --rapido 20
//       el mismo aguacero en 90 s
//   npm run demo -- --sin-placa
//       todo simulado (sin Arduino), para probar en cualquier portátil
//
// CAIMAN_PORT=/dev/tty.usbmodemXXXX elige el puerto si la detección falla.
// Requiere Node 18+ y StandardFirmata cargado en el Uno.

import { crearEstacion } from "../src/estacion.js";
import { crearCerebro } from "../src/cerebro.js";
import { crearAguacero, crearFuenteDemo } from "../src/aguacero.js";
import { CONFIG, UMBRALES } from "../src/config.js";

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const servidor = opcion("--servidor");
const rapido = Math.max(1, Number(opcion("--rapido")) || 1);
const sinPlaca = args.includes("--sin-placa");
const reportar = args.includes("--reportar");

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

  // Al salir (Ctrl+C): boca abierta (falla segura) y banda quieta. Con la placa
  // real, Johnny-Five atrapa Ctrl+C, emite "exit" y espera a que salgan los
  // últimos mensajes por el puerto antes de cerrar.
  board.on("exit", () => est.shutdown());
  if (sinPlaca) process.on("SIGINT", () => { est.shutdown(); process.exit(0); });
});

board.on("error", (err) => {
  console.error(`Error de la placa: ${err.message}`);
  process.exit(1);
});

// ---- Campo: el servidor de alertas decide ----------------------------------------
// Espera de GET /alerta un JSON como { "nivel": "NARANJA", "motivo": "..." }.
// Si no responde, la estación pasa sola a SIN_DATOS y luego abre la boca.
function consultarServidor(est) {
  const base = servidor.replace(/\/$/, "");
  let fallando = false;
  console.log(`Consultando ${base}/alerta cada 5 s`);
  setInterval(async () => {
    try {
      const r = await fetch(`${base}/alerta`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const a = await r.json();
      est.setAlerta(a.nivel ?? a.alerta, a.motivo ?? "");
      if (fallando) { console.log("Servidor de alertas de vuelta"); fallando = false; }
    } catch (e) {
      if (!fallando) console.log(`Sin respuesta de ${base}/alerta (${e.message})`);
      fallando = true;
    }
  }, 5000);

  if (reportar) {
    // Propuesta: el servidor aún no tiene este endpoint de escritura (la
    // especificación solo define GET /estacion/basura). Ajustar al implementarlo.
    setInterval(async () => {
      const { objetos, kg } = est.status();
      try {
        await fetch(`${base}/estacion/basura`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objetos, kg }),
          signal: AbortSignal.timeout(3000),
        });
      } catch { /* se reintenta en el siguiente envío */ }
    }, 60000);
  }
}

// ---- Feria: aguacero simulado en el portátil, sin internet -------------------------
function demoAguacero(est) {
  let ag, fuente, t0;
  const empezar = () => {
    ag = crearAguacero();
    fuente = crearFuenteDemo({ aguacero: ag, cerebro: crearCerebro(UMBRALES), umbrales: UMBRALES });
    t0 = Date.now();
    console.log(`Aguacero de demostración: 30 min${rapido > 1 ? ` a ×${rapido} (${(1800 / rapido).toFixed(0)} s)` : ""}`);
  };
  empezar();
  let ultimoResumen = -Infinity;
  setInterval(() => {
    const tS = ((Date.now() - t0) / 1000) * rapido;
    if (tS > 3600) { console.log("Fin del aguacero (60 min). Empieza otro."); empezar(); return; }
    const a = fuente.actualizar(tS);
    est.setAlerta(a.nivel, a.motivo);
    if (tS - ultimoResumen >= 30) {
      ultimoResumen = tS;
      const mm = `${String(Math.floor(tS / 60)).padStart(2, "0")}:${String(Math.floor(tS % 60)).padStart(2, "0")}`;
      const st = est.status();
      console.log(`[aguacero ${mm}] lluvia ${ag.lluviaMmMin(tS).toFixed(1)} mm/min · nivel ${ag.nivelCm(5, tS).toFixed(0)} cm · ${a.nivel} · ${st.modo} · ${st.objetos} objetos`);
    }
  }, Math.max(250, 5000 / rapido));
}
