// El "cerebro": calcula el nivel de alerta a partir de las lecturas de los ojos.
// Misma lógica que pide la especificación para el servidor de alertas:
//   VERDE    normal
//   AMARILLO lluvia fuerte aguas arriba (mm en 10 min)
//   NARANJA  el nivel sube rápido (cm por minuto)
//   ROJO     el nivel pasa la cota de desborde del punto
// La alerta de la estación es la peor de los ojos. Sube de inmediato y solo
// baja después de `bajarTrasMin` minutos sin cumplir la condición (evita parpadeos).

import { UMBRALES } from "./config.js";

export const NIVELES = Object.freeze(["VERDE", "AMARILLO", "NARANJA", "ROJO"]);
const rango = (n) => NIVELES.indexOf(n);

export function crearCerebro(umbrales = UMBRALES) {
  const lecturas = new Map(); // id -> [{ t, nivelCm, lluviaMm }]
  let estacion = { nivel: "VERDE", motivo: "normal", ojo: null };
  let bajarDesde = null;

  function agregarLectura({ id, t, nivelCm, lluviaMm = 0 }) {
    const l = lecturas.get(id) || [];
    l.push({ t, nivelCm, lluviaMm });
    while (l.length && l[0].t < t - 3600) l.shift();
    lecturas.set(id, l);
  }

  function alertaOjo(id, t) {
    const l = lecturas.get(id);
    if (!l || !l.length) return { nivel: "VERDE", motivo: "sin lecturas", ojo: id };
    const ult = l[l.length - 1];
    const cfg = umbrales.ojos.find((o) => o.id === id);

    if (cfg && ult.nivelCm >= cfg.cotaDesbordeCm)
      return { nivel: "ROJO", motivo: `${ult.nivelCm.toFixed(0)} cm ≥ cota ${cfg.cotaDesbordeCm} cm`, ojo: id };

    const ventanaS = umbrales.ventanaSubidaMin * 60;
    let ref = l[0];
    for (let i = l.length - 1; i >= 0; i--) if (l[i].t <= ult.t - ventanaS + 1) { ref = l[i]; break; }
    const subida = ult.t > ref.t ? (ult.nivelCm - ref.nivelCm) / ((ult.t - ref.t) / 60) : 0;
    if (subida >= umbrales.subidaCmMin)
      return { nivel: "NARANJA", motivo: `sube ${subida.toFixed(1)} cm/min`, ojo: id };

    const lluvia10 = l.filter((r) => r.t > t - 600).reduce((a, r) => a + r.lluviaMm, 0);
    if (lluvia10 >= umbrales.lluvia10minMm)
      return { nivel: "AMARILLO", motivo: `${lluvia10.toFixed(1)} mm en 10 min`, ojo: id };

    return { nivel: "VERDE", motivo: "normal", ojo: id };
  }

  function alertaEstacion(t) {
    const porOjo = umbrales.ojos.map((o) => alertaOjo(o.id, t));
    const peor = porOjo.reduce((a, b) => (rango(b.nivel) > rango(a.nivel) ? b : a));

    if (rango(peor.nivel) >= rango(estacion.nivel)) {
      estacion = peor;
      bajarDesde = null;
    } else {
      bajarDesde ??= t;
      if (t - bajarDesde >= umbrales.bajarTrasMin * 60) {
        estacion = peor;
        bajarDesde = null;
      }
    }
    return { ...estacion, porOjo };
  }

  return { agregarLectura, alertaOjo, alertaEstacion, lecturas };
}
