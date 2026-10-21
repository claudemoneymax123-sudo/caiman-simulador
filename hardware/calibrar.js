// Calibración en el banco, antes de correr la estación.
//   npm run calibrar
// En el REPL:
//   compuerta.to(20)    rampa tocando el agua           -> CONFIG.compuerta.cerradaDeg
//   compuerta.to(80)    rampa ~35° arriba, fuera del agua -> CONFIG.compuerta.abiertaDeg
//   banda.start(150)    velocidad normal; banda.stop()
//   ojos([255, 0, 0])   probar cada color de la tira
//   rugir(500)          buzzer durante 500 ms
// La barrera IR imprime "haz cortado" / "haz libre" al pasar la mano.

import five from "johnny-five";
import { CONFIG } from "../src/config.js";
import { conectarPlaca } from "./conectar.js";

const board = await conectarPlaca({ repl: true });

board.on("ready", () => {
  const P = CONFIG.pines;
  // Sin `range` a propósito: para calibrar se necesita todo el recorrido.
  // Mover de a pocos grados para no forzar la rampa contra sus topes.
  const compuerta = new five.Servo({ pin: P.compuerta, startAt: CONFIG.compuerta.cerradaDeg });
  const banda = new five.Motor({ pin: P.banda });
  const tira = new five.Led.RGB({ pins: { red: P.ojoRojo, green: P.ojoVerde, blue: P.ojoAzul } });
  const buzzer = new five.Pin(P.rugido);
  const barrera = new five.Button({ pin: P.contadorIR, isPullup: true });
  barrera.on("press", () => console.log("haz cortado"));
  barrera.on("release", () => console.log("haz libre"));

  board.repl.inject({
    compuerta,
    banda,
    ojos: (rgb) => tira.color(rgb),
    rugir: (ms = 500) => { buzzer.high(); setTimeout(() => buzzer.low(), ms); },
  });
  console.log("REPL de calibración listo: compuerta.to(g), banda.start(v), ojos([r,g,b]), rugir(ms)");
});
