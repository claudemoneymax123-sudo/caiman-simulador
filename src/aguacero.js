// Aguacero de demostración (30 min) sobre el arroyo Rebolo.
// Modelo SIMPLIFICADO y sin calibrar, solo para ferias y pruebas:
//   - lluvia: hietograma tipo gamma con pico a los 8 min (~45 mm en total)
//   - cada ojo: embalse lineal  dS/dt = g·lluvia(t − retardo) − S/T
//     (aguas abajo responde más tarde y sube más)
//   - basura: "primer lavado": la primera agua arrastra la mayor parte
// Se reemplaza por datos reales de los ojos cuando existan.

export const OJOS_DEMO = Object.freeze([
  // base y retardo en cm y s; T = tiempo de respuesta (s); g = ganancia
  { id: 1, base: 8, retardoS: 0, T: 150, g: 0.19 },
  { id: 2, base: 10, retardoS: 60, T: 220, g: 0.176 },
  { id: 3, base: 12, retardoS: 120, T: 300, g: 0.16 },
  { id: 4, base: 14, retardoS: 180, T: 400, g: 0.155 },
  { id: 5, base: 15, retardoS: 240, T: 520, g: 0.156 },
]);

export function crearAguacero({ duracionS = 1800, picoMmMin = 3.2, picoMin = 8, semilla = 7 } = {}) {
  const N = duracionS * 2; // seguimos 30 min más para ver la bajada
  let s = semilla;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  // Lluvia (mm/min) por segundo
  const lluvia = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i / 60 / picoMin;
    const base = i < duracionS ? picoMmMin * x * x * Math.exp(2 * (1 - x)) : 0;
    lluvia[i] = Math.max(0, base * (0.85 + 0.3 * rnd()));
  }

  // Nivel de cada ojo (cm) por segundo
  const niveles = OJOS_DEMO.map((o) => {
    const n = new Float32Array(N);
    let S = 0;
    for (let i = 0; i < N; i++) {
      const r = i - o.retardoS >= 0 ? lluvia[i - o.retardoS] : 0;
      S += o.g * r - S / o.T;
      n[i] = o.base + S;
    }
    return n;
  });

  // Basura que llega a la estación (objetos/min)
  const basura = new Float32Array(N);
  const n5 = niveles[4], base5 = OJOS_DEMO[4].base;
  let lavado = 0;
  for (let i = 0; i < N; i++) {
    const exceso = Math.max(0, n5[i] - base5);
    lavado += exceso / 60;
    basura[i] = 0.5 + 0.6 * exceso * Math.exp(-lavado / 900);
  }

  const idx = (t) => Math.min(N - 1, Math.max(0, Math.floor(t)));
  return {
    duracionS,
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
export function crearFuenteDemo({ aguacero, cerebro, umbrales }) {
  const estado = new Map(umbrales.ojos.map((o) => [o.id, { proximo: 0, ultimoEnvio: 0, hist: [] }]));
  let ultima = { nivel: "VERDE", motivo: "normal", porOjo: [] };
  let s = 3;
  const ruido = () => (((s = (s * 16807) % 2147483647) / 2147483647) - 0.5) * 1.0; // radar ±5 mm

  return {
    actualizar(t) {
      for (const o of umbrales.ojos) {
        const e = estado.get(o.id);
        if (t < e.proximo) continue;
        const nivelCm = aguacero.nivelCm(o.id, t) + ruido();
        const lluviaMm = aguacero.lluviaEntre(e.ultimoEnvio, t);
        cerebro.agregarLectura({ id: o.id, t, nivelCm, lluviaMm });
        e.hist.push({ t, nivelCm });
        while (e.hist.length && e.hist[0].t < t - 120) e.hist.shift();
        const subida2min = nivelCm - e.hist[0].nivelCm;
        e.ultimoEnvio = t;
        e.proximo = t + (subida2min > umbrales.rapidoSiSubeCm ? umbrales.envioRapidoS : umbrales.envioNormalS);
      }
      ultima = cerebro.alertaEstacion(t);
      return ultima;
    },
    ultima: () => ultima,
  };
}
