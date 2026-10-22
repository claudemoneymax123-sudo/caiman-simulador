// Aguacero de demostración (30 min de lluvia + 30 min de bajada) sobre el arroyo Rebolo.
// Modelo SIMPLIFICADO y sin calibrar, solo para ferias y pruebas:
//   - lluvia: hietograma tipo gamma con pico a los 8 min (~46 mm en total).
//     Intensidad de un evento convectivo fuerte; su periodo de retorno está POR
//     VERIFICAR contra las curvas IDF del IDEAM (estación Ernesto Cortissoz).
//   - retención inicial: los primeros `iaMm` mm no escurren (charcos, andenes).
//   - cada ojo: embalse lineal  dS/dt = g·lluvia(t − retardo) − S/T
//     (aguas abajo responde más tarde y sube más)
//   - basura: "primer lavado": la primera agua arrastra la mayor parte
// Se reemplaza por datos reales de los ojos cuando existan.

export const OJOS_DEMO = Object.freeze([
  // base y retardo en cm y s; T = tiempo de respuesta (s); g = ganancia
  { id: 1, base: 8, retardoS: 120, T: 150, g: 0.19 },
  { id: 2, base: 10, retardoS: 180, T: 220, g: 0.176 },
  { id: 3, base: 12, retardoS: 240, T: 300, g: 0.16 },
  { id: 4, base: 14, retardoS: 300, T: 400, g: 0.155 },
  { id: 5, base: 15, retardoS: 360, T: 520, g: 0.156 },
]);

/** El ojo que mide el nivel en la estación (junto al caimán). */
export const OJO_CAIMAN = 5;

// Sección del canal canalizado frente a la estación. La pendiente S0 y la
// rugosidad n son SUPUESTOS hasta medir en campo (flotadores en la Fase 1).
export const CANAL_HIDRAULICO = Object.freeze({ fondoM: 6, taludZ: 2.5 / 3.2, n: 0.015, S0: 0.002 });

/** Velocidad media del agua (m/s) con la ecuación de Manning para un canal trapezoidal. */
export function velocidadFlujo(nivelM, c = CANAL_HIDRAULICO) {
  const h = Math.max(0.02, nivelM);
  const A = (c.fondoM + c.taludZ * h) * h;
  const P = c.fondoM + 2 * h * Math.sqrt(1 + c.taludZ * c.taludZ);
  return (1 / c.n) * Math.pow(A / P, 2 / 3) * Math.sqrt(c.S0);
}

/** Nivel del Caño de la Auyama (m sobre el fondo del arroyo): lo controla el Magdalena,
 *  sube poco con el aguacero (remanso moderado, supuesto). */
export function nivelCanoM(nivelArroyoM) {
  return 0.6 + Math.min(0.2, 0.12 * Math.max(0, nivelArroyoM - 0.15));
}

export function crearAguacero({ duracionS = 1800, picoMmMin = 3.2, picoMin = 8, semilla = 7, iaMm = 5 } = {}) {
  const N = duracionS * 2; // seguimos 30 min más para ver la bajada
  let s = semilla;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  // Lluvia (mm/min) por segundo. El ruido va por bloques de 60 s: la resolución
  // de un pluviómetro de balancín, no un ruido segundo a segundo.
  const lluvia = new Float32Array(N);
  let factor = 1;
  for (let i = 0; i < N; i++) {
    if (i % 60 === 0) factor = 0.85 + 0.3 * rnd();
    const x = i / 60 / picoMin;
    const base = i < duracionS ? picoMmMin * x * x * Math.exp(2 * (1 - x)) : 0;
    lluvia[i] = Math.max(0, base * factor);
  }

  // Lluvia efectiva: nada escurre hasta llenar la retención inicial.
  const efectiva = new Float32Array(N);
  let acum = 0;
  for (let i = 0; i < N; i++) {
    const antes = acum;
    acum += lluvia[i] / 60;
    efectiva[i] = acum <= iaMm ? 0 : antes >= iaMm ? lluvia[i] : (acum - iaMm) * 60;
  }

  // Nivel de cada ojo (cm) por segundo
  const niveles = OJOS_DEMO.map((o) => {
    const n = new Float32Array(N);
    let S = 0;
    for (let i = 0; i < N; i++) {
      const r = i - o.retardoS >= 0 ? efectiva[i - o.retardoS] : 0;
      S += o.g * r - S / o.T;
      n[i] = o.base + S;
    }
    return n;
  });

  // Basura que llega a la estación (objetos/min)
  const basura = new Float32Array(N);
  const n5 = niveles[OJO_CAIMAN - 1], base5 = OJOS_DEMO[OJO_CAIMAN - 1].base;
  let lavado = 0;
  for (let i = 0; i < N; i++) {
    const exceso = Math.max(0, n5[i] - base5);
    lavado += exceso / 60;
    basura[i] = 0.5 + 0.6 * exceso * Math.exp(-lavado / 900);
  }

  const idx = (t) => Math.min(N - 1, Math.max(0, Math.floor(t)));
  return {
    duracionS,
    totalS: N,
    lluviaMmMin: (t) => lluvia[idx(t)],
    lluviaEntre(t0, t1) {
      let mm = 0;
      for (let i = idx(t0); i < idx(t1); i++) mm += lluvia[i] / 60;
      return mm;
    },
    nivelCm: (id, t) => niveles[id - 1][idx(t)],
    basuraObjMin: (t) => basura[idx(t)],
    lluviaTotalMm: () => lluvia.reduce((a, b) => a + b / 60, 0),
  };
}

// Fuente de alertas para la demo sin internet: simula el envío de cada ojo
// (cada 60 s, o cada 15 s si sube > 15 cm en 2 min, igual que el firmware)
// y alimenta al cerebro. Devuelve la alerta de la estación, como GET /alerta.
// apagarOjo(id) simula un ojo caído (batería, radio) para enseñar la redundancia.
export function crearFuenteDemo({ aguacero, cerebro, umbrales }) {
  const estado = new Map(umbrales.ojos.map((o) => [o.id, { proximo: 0, ultimoEnvio: 0, hist: [] }]));
  const apagados = new Set();
  let ultima = { nivel: "VERDE", motivo: "normal", porOjo: [], sinDatos: false };
  let s = 3;
  const ruido = () => (((s = (s * 16807) % 2147483647) / 2147483647) - 0.5) * 1.0; // radar ±5 mm

  return {
    actualizar(t) {
      for (const o of umbrales.ojos) {
        const e = estado.get(o.id);
        if (t < e.proximo) continue;
        const lluviaMm = aguacero.lluviaEntre(e.ultimoEnvio, t);
        e.ultimoEnvio = t;
        if (apagados.has(o.id)) { e.proximo = t + umbrales.envioNormalS; continue; }
        const nivelCm = aguacero.nivelCm(o.id, t) + ruido();
        cerebro.agregarLectura({ id: o.id, t, nivelCm, lluviaMm });
        e.hist.push({ t, nivelCm });
        while (e.hist.length && e.hist[0].t < t - 120) e.hist.shift();
        const subida2min = nivelCm - e.hist[0].nivelCm;
        e.proximo = t + (subida2min > umbrales.rapidoSiSubeCm ? umbrales.envioRapidoS : umbrales.envioNormalS);
      }
      ultima = cerebro.alertaEstacion(t);
      return ultima;
    },
    apagarOjo(id, apagado = true) { apagado ? apagados.add(id) : apagados.delete(id); },
    ojoApagado: (id) => apagados.has(id),
    ultima: () => ultima,
  };
}
