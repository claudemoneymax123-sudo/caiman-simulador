// El "cerebro": calcula el nivel de alerta a partir de las lecturas de los ojos.
// Misma lógica que pide la especificación para el servidor de alertas:
//   VERDE    normal
//   AMARILLO lluvia fuerte aguas arriba (mm en 10 min)
//   NARANJA  el nivel sube rápido (cm por minuto)
//   ROJO     el nivel pasa la cota de desborde del punto
// La alerta de la estación es la peor de los ojos. Sube de inmediato y baja
// UN escalón por cada `bajarTrasMin` minutos sin cumplir la condición, para que la
// gente vea que "va bajando" y nadie pase de ROJO a VERDE con el agua todavía alta.
//
// "No sé" no es "no hay peligro": un ojo sin lecturas recientes se marca sinDatos,
// y si ningún ojo tiene datos, la estación recibe sinDatos y no una alerta VERDE.

import { UMBRALES } from "./config.js";

export const NIVELES = Object.freeze(["VERDE", "AMARILLO", "NARANJA", "ROJO"]);
const rango = (n) => NIVELES.indexOf(n);

// Sube de inmediato; baja un escalón por cada `bajarS` segundos por debajo.
function crearRetencion(bajarS) {
  let actual = { nivel: "VERDE", motivo: "normal" };
  let bajarDesde = null;
  return (crudo, t) => {
    if (rango(crudo.nivel) >= rango(actual.nivel)) {
      actual = crudo;
      bajarDesde = null;
    } else {
      bajarDesde ??= t;
      if (t - bajarDesde >= bajarS) {
        const unoMenos = NIVELES[rango(actual.nivel) - 1];
        actual = rango(crudo.nivel) >= rango(unoMenos) ? crudo : { ...crudo, nivel: unoMenos, motivo: `bajando · ${crudo.motivo}` };
        bajarDesde = rango(actual.nivel) > rango(crudo.nivel) ? t : null;
      }
    }
    return actual;
  };
}

export function crearCerebro(umbrales = UMBRALES) {
  const lecturas = new Map(); // id -> [{ t, nivelCm, lluviaMm }]
  const descartadas = new Map(); // id -> lecturas inválidas (NaN, null…)
  const bajarS = umbrales.bajarTrasMin * 60;
  const retenEstacion = crearRetencion(bajarS);
  const retenOjo = new Map(umbrales.ojos.map((o) => [o.id, crearRetencion(bajarS)]));

  function agregarLectura({ id, t, nivelCm, lluviaMm = 0 }) {
    if (!Number.isFinite(nivelCm) || !Number.isFinite(t)) {
      descartadas.set(id, (descartadas.get(id) || 0) + 1);
      return false;
    }
    const l = lecturas.get(id) || [];
    l.push({ t, nivelCm, lluviaMm: Number.isFinite(lluviaMm) ? lluviaMm : 0 });
    while (l.length && l[0].t < t - 3600) l.shift();
    lecturas.set(id, l);
    return true;
  }

  // Regla instantánea de un ojo (sin retención).
  function alertaOjo(id, t) {
    const l = lecturas.get(id);
    if (!l || !l.length) return { nivel: "VERDE", motivo: "sin lecturas", ojo: id, sinDatos: true };
    const ult = l[l.length - 1];
    if (t - ult.t > (umbrales.ojoSinDatosS ?? Infinity))
      return { nivel: "VERDE", motivo: `sin datos hace ${Math.round((t - ult.t) / 60)} min`, ojo: id, sinDatos: true };
    const cfg = umbrales.ojos.find((o) => o.id === id);

    if (cfg && ult.nivelCm >= cfg.cotaDesbordeCm)
      return { nivel: "ROJO", motivo: `${ult.nivelCm.toFixed(0)} cm ≥ nivel de peligro ${cfg.cotaDesbordeCm} cm`, ojo: id };

    const ventanaS = umbrales.ventanaSubidaMin * 60;
    let ref = l[0];
    for (let i = l.length - 1; i >= 0; i--) if (l[i].t <= ult.t - ventanaS + 1) { ref = l[i]; break; }
    const subida = ult.t > ref.t ? (ult.nivelCm - ref.nivelCm) / ((ult.t - ref.t) / 60) : 0;
    if (subida >= umbrales.subidaCmMin)
      return { nivel: "NARANJA", motivo: `sube ${subida.toFixed(1).replace(".", ",")} cm/min`, ojo: id };

    const lluvia10 = l.filter((r) => r.t > t - 600).reduce((a, r) => a + r.lluviaMm, 0);
    if (lluvia10 >= umbrales.lluvia10minMm)
      return { nivel: "AMARILLO", motivo: `${lluvia10.toFixed(1).replace(".", ",")} mm en 10 min`, ojo: id };

    return { nivel: "VERDE", motivo: "normal", ojo: id };
  }

  function alertaEstacion(t) {
    const crudos = umbrales.ojos.map((o) => alertaOjo(o.id, t));
    // Lo que se muestra por ojo pasa por la misma retención (no parpadea en la cota).
    const porOjo = crudos.map((c) => ({ ...retenOjo.get(c.ojo)(c, t), sinDatos: !!c.sinDatos }));
    const conDatos = crudos.filter((c) => !c.sinDatos);
    const ojosSinDatos = crudos.length - conDatos.length;
    if (!conDatos.length) {
      return { nivel: retenEstacion({ nivel: "VERDE", motivo: "sin datos" }, t).nivel, motivo: "ningún ojo tiene datos", ojo: null, sinDatos: true, ojosSinDatos, porOjo };
    }
    const peor = conDatos.reduce((a, b) => (rango(b.nivel) > rango(a.nivel) ? b : a));
    const est = retenEstacion(peor, t);
    return { ...est, sinDatos: false, ojosSinDatos, porOjo };
  }

  return { agregarLectura, alertaOjo, alertaEstacion, lecturas, descartadas };
}
