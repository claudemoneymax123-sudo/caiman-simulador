// El río y la basura: física pura (sin Three.js), para poder probarla en Node.
// La escena 3D solo copia las posiciones que calcula este módulo a sus mallas.
// Unidades: metros y segundos, a escala real. El agua corre hacia +X.

/** Canal de concreto del arroyo Rebolo frente a la estación. */
export const CANAL = Object.freeze({ fondoY: -3.2, mediaFondo: 3, mediaBorde: 5.5, xIni: -75, xFin: 25 });
/** Rampa (mandíbula inferior) con su banda; bisagra en x = -3, 0,43 m sobre el agua. */
export const RAMPA = Object.freeze({ largo: 5, ancho: 2.6, bisagraX: -3, alturaBisagra: 0.43, sobreBanda: 0.3, sobreBorde: 0.22 });

const lerp = (a, b, t) => a + (b - a) * t;

/** Barreras flotantes en V que llevan la basura a la punta de la rampa (cerrada a −25°). */
export function geometriaBarreras(rampa = RAMPA) {
  const puntaX = rampa.bisagraX - rampa.largo * Math.cos((25 * Math.PI) / 180);
  const desde = { x: -24, z: 4.9 }, hasta = { x: puntaX - 0.2, z: 1.35 };
  // Ancho libre entre barreras en x (null fuera de la V).
  const barreraZ = (x) => (x < desde.x || x > puntaX ? null : lerp(desde.z, hasta.z, (x - desde.x) / (puntaX - desde.x)));
  return { puntaX, desde, hasta, barreraZ };
}

/** Tipos de basura: proporción, largo sobre la banda (m), masa (kg) y cuántos colores tiene. */
export const TIPOS_BASURA = Object.freeze([
  { nombre: "botella", p: 0.38, largo: 0.42, kg: 0.03, colores: 3 },
  { nombre: "bolsa", p: 0.25, largo: 0.5, kg: 0.01, colores: 3 },
  { nombre: "icopor", p: 0.22, largo: 0.34, kg: 0.01, colores: 1 },
  { nombre: "lata", p: 0.1, largo: 0.2, kg: 0.015, colores: 2 },
  { nombre: "chancla", p: 0.05, largo: 0.3, kg: 0.12, colores: 2 },
]);

/** Geometría de la rampa en el mundo a partir de su ángulo (° sobre la horizontal; negativo = hacia el agua). */
export function rampaEnElMundo(rampaDeg, aguaY, rampa = RAMPA) {
  const th = (-rampaDeg * Math.PI) / 180;
  const bx = rampa.bisagraX, by = aguaY + rampa.alturaBisagra;
  const aMundo = (lx, ly) => ({ x: bx + lx * Math.cos(th) - ly * Math.sin(th), y: by + lx * Math.sin(th) + ly * Math.cos(th) });
  const punta = aMundo(-rampa.largo, rampa.sobreBorde);
  return { th, bx, by, puntaX: punta.x, puntaY: punta.y, sumergida: punta.y < aguaY - 0.05, aMundo };
}

/**
 * crearRio({ canal, rampa, barreraZ, rng }) → { basura, cuenta, soltar, paso, tomarRemovidos }
 *
 * soltar(nivelM)  echa un objeto al agua aguas arriba y lo devuelve.
 * paso(h, { rampaDeg, aguaY, vBanda, andando, velFlujo, nivelM, t, alturaEn })
 *   avanza h segundos y devuelve { hazTapado, cargaBanda, rampa }.
 *   Cada objeto queda con su posición en el mundo (b.px, b.py, b.pz).
 * tomarRemovidos() devuelve (y vacía) los objetos que salieron: a la panza, aguas abajo o descartados.
 */
export function crearRio({
  canal = CANAL, rampa = RAMPA, barreraZ = geometriaBarreras(rampa).barreraZ, rng = Math.random,
  tipos = TIPOS_BASURA, maxBasura = 320, capacidadBoca = 40, xInicio = -46, xFinal = 120,
  separacionBanda = 0.55, haz = rampa.largo - 0.45,
} = {}) {
  const basura = [];
  const removidos = [];
  const cuenta = { soltadas: 0, atrapadas: 0, porTipo: {}, escapadas: 0, descartadas: 0 };
  const estado = { panzaKg: 0 };
  let siguienteId = 1;

  const quitar = (i) => { removidos.push(basura[i]); basura.splice(i, 1); };

  function soltar(nivelM) {
    let r = rng(), tipo = tipos[0];
    for (const x of tipos) { if ((r -= x.p) <= 0) { tipo = x; break; } }
    const media = canal.mediaFondo + nivelM * ((canal.mediaBorde - canal.mediaFondo) / -canal.fondoY) - 0.4;
    const b = {
      id: siguienteId++, tipo, color: Math.floor(rng() * tipo.colores),
      estado: "rio", x: xInicio, z: (rng() * 2 - 1) * media, s: 0, giro: rng() * 6, fase: rng() * 6,
      contada: false, pasa: false, px: xInicio, py: 0, pz: 0,
    };
    b.pz = b.z;
    basura.push(b);
    cuenta.soltadas++;
    if (basura.length > maxBasura) {
      // Se retira primero lo que ya escapó aguas abajo; si no hay, lo más viejo (y se cuenta).
      let i = basura.findIndex((v) => v.contada);
      if (i < 0) { i = 0; cuenta.descartadas++; }
      quitar(i);
    }
    return b;
  }

  function paso(h, { rampaDeg, aguaY, vBanda = 0, andando = vBanda > 0.03, velFlujo, nivelM, t = 0, alturaEn }) {
    const rm = rampaEnElMundo(rampaDeg, aguaY, rampa);
    const media = canal.mediaFondo + nivelM * ((canal.mediaBorde - canal.mediaFondo) / -canal.fondoY) - 0.3;
    const yAgua = alturaEn || (() => aguaY);
    let enBanda = 0, hazTapado = false, ultimaEntrada = Infinity, enBoca = 0, filaBoca = 0;
    for (const b of basura) {
      if (b.estado === "banda") ultimaEntrada = Math.min(ultimaEntrada, b.s);
      if (b.estado === "boca") enBoca++;
    }
    for (let i = basura.length - 1; i >= 0; i--) {
      const b = basura[i];
      if (b.estado === "rio") {
        b.x += velFlujo * h * (1.05 + 0.1 * Math.sin(b.fase)); // lo que flota va un poco más rápido que el promedio
        b.z += Math.sin(b.fase + t * 0.7) * 0.15 * h;
        const bz = barreraZ(b.x);
        if (bz !== null && Math.abs(b.z) > bz - 0.15) b.z = Math.sign(b.z) * (bz - 0.15); // la barrera la empuja al centro
        b.z = Math.max(-media, Math.min(media, b.z));
        if (!b.pasa && rm.sumergida && b.x >= rm.puntaX - 0.25 && b.x < rampa.bisagraX && Math.abs(b.z) < 1.25) {
          if (andando && ultimaEntrada > separacionBanda) { b.estado = "banda"; b.s = 0; ultimaEntrada = 0; }
          else if (enBoca < capacidadBoca) { b.estado = "boca"; enBoca++; }
          else b.pasa = true; // la boca está llena: rebosa y sigue con la corriente
        }
        if (!b.contada && b.x > rampa.bisagraX + 2) { b.contada = true; cuenta.escapadas++; }
        if (b.x > xFinal) { quitar(i); continue; }
        b.px = b.x; b.py = yAgua(b.x, b.z) + 0.03; b.pz = b.z;
      } else if (b.estado === "boca") {
        if (!rm.sumergida) { b.estado = "rio"; continue; } // la boca se levantó: pasa por debajo
        if (andando && ultimaEntrada > separacionBanda) { b.estado = "banda"; b.s = 0; ultimaEntrada = 0; continue; }
        filaBoca++;
        b.px = rm.puntaX - 0.35 - (filaBoca % 7) * 0.18;
        b.py = aguaY + 0.04 + Math.floor(filaBoca / 7) * 0.06;
        b.pz = Math.max(-1.1, Math.min(1.1, b.z));
      } else if (b.estado === "banda") {
        if (andando) b.s += vBanda * h;
        if (b.s >= rampa.largo - 0.05) {
          estado.panzaKg += b.tipo.kg;
          cuenta.atrapadas++;
          cuenta.porTipo[b.tipo.nombre] = (cuenta.porTipo[b.tipo.nombre] || 0) + 1;
          b.estado = "panza";
          quitar(i);
          continue;
        }
        enBanda++;
        if (Math.abs(b.s - haz) < b.tipo.largo / 2) hazTapado = true;
        const p = rm.aMundo(-rampa.largo + b.s, rampa.sobreBanda);
        b.px = p.x; b.py = p.y; b.pz = Math.max(-1.1, Math.min(1.1, b.z * 0.8));
      }
    }
    return { hazTapado, cargaBanda: Math.min(0.5, enBanda * 0.02), rampa: rm, enBanda, enBoca };
  }

  return {
    basura, cuenta,
    get panzaKg() { return estado.panzaKg; },
    soltar, paso,
    tomarRemovidos() { return removidos.splice(0); },
    /** En tránsito = todo lo que sigue en el agua o en la boca y no ha escapado. */
    enTransito: () => basura.filter((b) => !b.contada).length,
  };
}
