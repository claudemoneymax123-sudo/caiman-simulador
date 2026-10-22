// La demo del aguacero, compartida por el simulador (sim/main.js) y la maqueta
// en una feria sin internet (hardware/run.js): crea el aguacero, el cerebro y los
// ojos simulados, y cada `cadaS` segundos le pasa la alerta a la estación, igual
// que haría el servidor al responder GET /alerta.

import { crearAguacero, crearFuenteDemo } from "./aguacero.js";
import { crearCerebro } from "./cerebro.js";
import { UMBRALES } from "./config.js";

/** Tiempo en minutos:segundos, como el reloj de la demo. */
export const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function crearDemo({ umbrales = UMBRALES, cadaS = 5, aguacero = {} } = {}) {
  let ag, cerebro, fuente, ultima;
  const reiniciar = () => {
    ag = crearAguacero(aguacero);
    cerebro = crearCerebro(umbrales);
    fuente = crearFuenteDemo({ aguacero: ag, cerebro, umbrales });
    ultima = -Infinity;
  };
  reiniciar();

  return {
    get ag() { return ag; },
    get cerebro() { return cerebro; },
    get fuente() { return fuente; },
    reiniciar,
    /** Duración total (lluvia + bajada), en segundos. */
    get totalS() { return ag.totalS; },
    /**
     * Avanza la demo hasta tS (segundos del aguacero). Si toca consultar, actualiza
     * los ojos y el cerebro y, si hay conexión y datos, renueva la alerta de la estación.
     * Devuelve la alerta nueva, o null si todavía no tocaba.
     */
    tick(tS, est, { conectado = true } = {}) {
      if (tS - ultima < cadaS) return null;
      ultima = tS;
      const a = fuente.actualizar(tS);
      if (est && conectado && !a.sinDatos) est.setAlerta(a.nivel, a.motivo);
      return a;
    },
    ultima: () => fuente.ultima(),
  };
}
