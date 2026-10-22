// Escena 3D: el Caimán 1 en la salida del arroyo Rebolo al Caño de la Auyama.
// Unidades: metros, a escala real (la electrónica es la de la maqueta 1:5).
// El agua corre hacia +X. El arroyo está canalizado (concreto) y desemboca
// en el caño, con manglar. La estación flota y sube con el agua.

import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { Sky } from "three/addons/objects/Sky.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export const CANAL = { fondoY: -3.2, mediaFondo: 3, mediaBorde: 5.5, xIni: -75, xFin: 25 };
export const RAMPA = { largo: 5, ancho: 2.6, bisagraX: -3 };

// ---- Texturas procedurales ----------------------------------------------------
function lienzo(w, h, pintar) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  pintar(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function texEscamas(size = 512, celdas = 22) {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts = [];
  for (let j = 0; j < celdas; j++) for (let i = 0; i < celdas; i++) pts.push([(i + 0.15 + 0.7 * rnd()) / celdas, (j + 0.15 + 0.7 * rnd()) / celdas, rnd()]);
  const t = lienzo(size, size, (g) => {
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, ci = Math.floor(u * celdas), cj = Math.floor(v * celdas);
      let f1 = 9, f2 = 9, tono = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + celdas) % celdas, jj = (cj + dj + celdas) % celdas, p = pts[jj * celdas + ii];
        const d = Math.hypot(p[0] + (ci + di - ii) / celdas - u, (p[1] + (cj + dj - jj) / celdas - v) * 1.25);
        if (d < f1) { f2 = f1; f1 = d; tono = p[2]; } else if (d < f2) f2 = d;
      }
      const borde = Math.min(1, (f2 - f1) * celdas * 2.2), domo = 1 - Math.min(1, f1 * celdas * 1.4);
      const val = Math.round(255 * (0.25 + 0.55 * borde + 0.2 * domo) * (0.88 + 0.12 * tono));
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = val; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const texConcreto = () => lienzo(512, 512, (g, w, h) => {
  g.fillStyle = "#9a978f"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) { const v = 120 + Math.random() * 60; g.fillStyle = `rgba(${v},${v - 4},${v - 10},.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(60,55,40,${0.05 + Math.random() * 0.1})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 80, 6 + Math.random() * 30, 0, 0, 7); g.fill(); }
  g.strokeStyle = "rgba(50,50,50,.5)"; g.lineWidth = 2;
  for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
});

const texAsfalto = () => lienzo(512, 512, (g, w, h) => {
  g.fillStyle = "#4a4a4c"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14000; i++) { const v = 50 + Math.random() * 50; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
});

const texBanda = () => lienzo(64, 256, (g, w, h) => {
  g.fillStyle = "#1c1c1c"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#3a3a3a";
  for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 6); // tacos de la banda
});

const texPanel = () => lienzo(256, 256, (g, w, h) => {
  g.fillStyle = "#14254a"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#8aa0c8"; g.lineWidth = 2;
  for (let x = 0; x <= w; x += w / 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y <= h; y += h / 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
});

const cacheTex = new Map();
const unaVez = (clave, crear) => cacheTex.get(clave) || cacheTex.set(clave, crear()).get(clave);

function texFachada(color) {
  return unaVez(`fachada:${color}`, () => lienzo(128, 128, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(0,0,0,.08)"; g.fillRect(0, h - 10, w, 10);
    g.fillStyle = "#2b3440";
    for (let x = 14; x < w - 20; x += 40) g.fillRect(x, 30, 22, 30);
    g.fillStyle = "#5b3a24"; g.fillRect(w / 2 - 10, 78, 20, 50);
  }));
}

// ---- Geometrías -----------------------------------------------------------------
function quad(a, b, c, d, repU, repV) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, repU, 0, repU, repV, 0, 0, repU, repV, 0, repV], 2));
  g.computeVertexNormals();
  return g;
}

// Cuerpo redondeado que se angosta (casco, mandíbula, cola).
function cuerpoGeo({ largo, ancho0, ancho1, alto0, alto1, bajo = 0.5, puntaRedonda = 0.9, segs = 64 }, deformar) {
  let g = new THREE.BoxGeometry(1, 1, 1, segs, 10, 16);
  const pos = g.attributes.position, n = 2.6;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5;
    let v = pos.getY(i) * 2, w = pos.getZ(i) * 2;
    const m = Math.max(Math.abs(v), Math.abs(w)), r = Math.pow(Math.abs(v) ** n + Math.abs(w) ** n, 1 / n);
    if (r > 0) { v *= m / r; w *= m / r; }
    const hw = lerp(ancho0, ancho1, smooth(0.05, 1, u)), h = lerp(alto0, alto1, smooth(0.1, 1, u));
    let X = u * largo - Math.pow(u, 6) * w * w * hw * puntaRedonda;
    let Y = v >= 0 ? v * h : v * h * bajo, Z = w * hw;
    if (deformar) [X, Y, Z] = deformar(X, Y, Z, u, v, w);
    pos.setXYZ(i, X, Y, Z);
  }
  g.deleteAttribute("normal"); g.deleteAttribute("uv");
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const P = g.attributes.position, uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) { uv[i * 2] = P.getX(i) / 2.2; uv[i * 2 + 1] = (P.getZ(i) + P.getY(i) * 0.8) / 2.2; }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

function etiqueta(texto, cls = "") {
  const d = document.createElement("div");
  d.className = `etiqueta3d ${cls}`;
  d.textContent = texto;
  return new CSS2DObject(d);
}

// ---- Escena ---------------------------------------------------------------------
export const RAMPA_DARSENA = { desdeX: -14, hastaX: 12, hondoM: 1.7 }; // fosa bajo la estación (supuesto de diseño)

export function construirEscena(renderer, opts = {}) {
  const baja = opts.calidad === "baja";
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 3000);
  camera.position.set(-33, 7.5, 9.5);

  // Cielo + sol (se nubla con la lluvia)
  const sky = new Sky();
  sky.scale.setScalar(2500);
  scene.add(sky);
  const sol = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(200));
  sky.material.uniforms.sunPosition.value.copy(sol);
  const solLuz = new THREE.DirectionalLight("#fff1dc", 2.6);
  solLuz.position.copy(sol).multiplyScalar(120);
  solLuz.castShadow = true;
  solLuz.shadow.mapSize.set(baja ? 1024 : 2048, baja ? 1024 : 2048);
  Object.assign(solLuz.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
  solLuz.shadow.bias = -0.0005;
  scene.add(solLuz);
  const hemi = new THREE.HemisphereLight("#cfe3ff", "#5a5040", 0.7);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2("#c9d3dc", 0.004);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(sky, 0.0).texture;

  // ---- Canal de concreto ----
  const { fondoY, mediaFondo, mediaBorde, xIni, xFin } = CANAL;
  const largoCanal = xFin - xIni;
  const tConcreto = unaVez("concreto", texConcreto);
  const concreto = new THREE.MeshStandardMaterial({ map: tConcreto, roughness: 0.92 });
  const muroI = new THREE.Mesh(quad([xIni, fondoY, -mediaFondo], [xFin, fondoY, -mediaFondo], [xFin, 0, -mediaBorde], [xIni, 0, -mediaBorde], largoCanal / 6, 1), concreto);
  const muroD = new THREE.Mesh(quad([xFin, fondoY, mediaFondo], [xIni, fondoY, mediaFondo], [xIni, 0, mediaBorde], [xFin, 0, mediaBorde], largoCanal / 6, 1), concreto);
  // Fondo con una dársena (fosa) bajo la estación: así la rampa abajo y el casco
  // tienen agua debajo aun con el arroyo casi seco, en vez de atravesar el concreto.
  const { desdeX: dX0, hastaX: dX1, hondoM } = RAMPA_DARSENA, yD = fondoY - hondoM;
  const fondo = [
    quad([xIni, fondoY, mediaFondo], [dX0, fondoY, mediaFondo], [dX0, fondoY, -mediaFondo], [xIni, fondoY, -mediaFondo], (dX0 - xIni) / 6, 1),
    quad([dX1, fondoY, mediaFondo], [xFin, fondoY, mediaFondo], [xFin, fondoY, -mediaFondo], [dX1, fondoY, -mediaFondo], (xFin - dX1) / 6, 1),
    quad([dX0, yD, mediaFondo], [dX1, yD, mediaFondo], [dX1, yD, -mediaFondo], [dX0, yD, -mediaFondo], (dX1 - dX0) / 6, 1),
    quad([dX0, fondoY, -mediaFondo], [dX0, fondoY, mediaFondo], [dX0, yD, mediaFondo], [dX0, yD, -mediaFondo], 1, 0.5),
    quad([dX1, fondoY, mediaFondo], [dX1, fondoY, -mediaFondo], [dX1, yD, -mediaFondo], [dX1, yD, mediaFondo], 1, 0.5),
    quad([dX0, yD, -mediaFondo], [dX1, yD, -mediaFondo], [dX1, fondoY, -mediaFondo], [dX0, fondoY, -mediaFondo], (dX1 - dX0) / 6, 0.5),
    quad([dX1, yD, mediaFondo], [dX0, yD, mediaFondo], [dX0, fondoY, mediaFondo], [dX1, fondoY, mediaFondo], (dX1 - dX0) / 6, 0.5),
  ].map((g) => new THREE.Mesh(g, concreto));
  for (const m of [muroI, muroD, ...fondo]) { m.receiveShadow = true; m.material.side = THREE.DoubleSide; scene.add(m); }

  // Marca roja de la cota de desborde del ojo 5 pintada en los muros (provisional)
  const cotaM = opts.cotaM ?? 1.5;
  const zEn = (h) => mediaFondo + (h / -fondoY) * (mediaBorde - mediaFondo) - 0.03;
  const rojaMat = new THREE.MeshBasicMaterial({ color: "#e0262b", side: THREE.DoubleSide });
  for (const sg of [-1, 1]) {
    const h0 = cotaM - 0.05, h1 = cotaM + 0.05;
    scene.add(new THREE.Mesh(quad([-40, fondoY + h0, sg * zEn(h0)], [xFin, fondoY + h0, sg * zEn(h0)], [xFin, fondoY + h1, sg * zEn(h1)], [-40, fondoY + h1, sg * zEn(h1)], 1, 1), rojaMat));
  }
  const etCota = etiqueta("nivel de peligro (provisional)", "cota");
  etCota.position.set(-30, fondoY + cotaM + 0.35, -zEn(cotaM));
  scene.add(etCota);

  // Calles y andenes a ambos lados
  const asfalto = new THREE.MeshStandardMaterial({ map: texAsfalto(), roughness: 0.95 });
  asfalto.map.repeat.set(30, 4);
  for (const s of [-1, 1]) {
    const calle = new THREE.Mesh(new THREE.PlaneGeometry(largoCanal + 40, 14), asfalto);
    calle.rotation.x = -Math.PI / 2;
    calle.position.set((xIni + xFin) / 2 - 20, 0, s * (mediaBorde + 7.6));
    calle.receiveShadow = true;
    const anden = new THREE.Mesh(new THREE.BoxGeometry(largoCanal + 40, 0.25, 1.4), new THREE.MeshStandardMaterial({ color: "#b9b4a8", roughness: 0.9 }));
    anden.position.set((xIni + xFin) / 2 - 20, 0.12, s * (mediaBorde + 0.7));
    anden.receiveShadow = anden.castShadow = true;
    // Baranda metálica del canal
    const baranda = new THREE.Mesh(new THREE.BoxGeometry(largoCanal, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: "#2e5d3a", metalness: 0.6, roughness: 0.5 }));
    baranda.position.set((xIni + xFin) / 2, 1.05, s * (mediaBorde + 0.2));
    scene.add(calle, anden, baranda);
    for (let x = xIni; x <= xFin; x += 2.5) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.05, 0.06), baranda.material);
      p.position.set(x, 0.52, s * (mediaBorde + 0.2));
      scene.add(p);
    }
  }

  // Puente de la carrera (aguas arriba)
  const puente = new THREE.Mesh(new THREE.BoxGeometry(9, 0.8, 2 * mediaBorde + 8), concreto);
  puente.position.set(-52, 0.1, 0);
  puente.castShadow = puente.receiveShadow = true;
  scene.add(puente);

  // Barrio: casas bajas de colores
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const techoMat = new THREE.MeshStandardMaterial({ color: "#a9a59b", roughness: 0.9 });
  const colores = ["#f2d16b", "#e98c6a", "#7ec4cf", "#b8d98a", "#f5f0e6", "#d9a5c8", "#f0a24a", "#9fb7e0"];
  for (const lado of [-1, 1]) {
    for (let x = xIni - 25; x < xFin + 5; x += 7 + rnd() * 3) {
      const ancho = 6 + rnd() * 3, alto = 3 + rnd() * 4.5, fondoC = 7 + rnd() * 4;
      const color = colores[Math.floor(rnd() * colores.length)];
      const mat = unaVez(`matFachada:${color}`, () => new THREE.MeshStandardMaterial({ map: texFachada(color), roughness: 0.85 }));
      // Fachadas a los lados, techo y piso lisos (antes había ventanas en el techo)
      const casa = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto, fondoC), [mat, mat, techoMat, techoMat, mat, mat]);
      casa.position.set(x, alto / 2, lado * (mediaBorde + 15 + fondoC / 2 + rnd() * 2));
      casa.castShadow = casa.receiveShadow = true;
      scene.add(casa);
    }
  }
  // Terreno: ciudad a nivel de calle a los lados del canal; orillas bajas de lodo en el caño.
  const tierra = new THREE.MeshStandardMaterial({ color: "#8d8a72", roughness: 1 });
  const lodo = new THREE.MeshStandardMaterial({ color: "#5d5440", roughness: 1 });
  const plano = (x0, x1, z0, z1, y, m) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m);
    p.rotation.x = -Math.PI / 2;
    p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    p.receiveShadow = true;
    scene.add(p);
  };
  for (const sg of [-1, 1]) {
    plano(-500, xFin, Math.min(sg * mediaBorde, sg * 500), Math.max(sg * mediaBorde, sg * 500), -0.05, tierra);
    plano(xFin, 500, Math.min(sg * 24, sg * 500), Math.max(sg * 24, sg * 500), fondoY + 0.6, lodo);
    const muro = new THREE.Mesh(new THREE.BoxGeometry(1, -fondoY, 476), concreto);
    muro.position.set(xFin + 0.5, fondoY / 2, sg * (mediaBorde + 238));
    muro.castShadow = muro.receiveShadow = true;
    scene.add(muro);
  }
  plano(-500, -400, -500, 500, -0.05, tierra);

  // Palmeras
  const tronco = new THREE.MeshStandardMaterial({ color: "#7a6046", roughness: 0.9 });
  const hoja = new THREE.MeshStandardMaterial({ color: "#3f7a32", roughness: 0.7, side: THREE.DoubleSide });
  const palmera = (x, z, h) => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h, 8), tronco);
    t.position.y = h / 2; t.castShadow = true;
    g.add(t);
    for (let i = 0; i < 8; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.6, 4, 1, true), hoja);
      f.position.set(0, h, 0);
      f.rotation.set(Math.PI / 2 - 0.5, (i / 8) * Math.PI * 2, 0, "YXZ");
      f.translateY(1.6);
      f.scale.set(1, 1, 0.15);
      f.castShadow = !baja;
      g.add(f);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  };
  for (let i = 0; i < 22; i++) {
    const x = xIni + rnd() * (largoCanal + 20), z = (rnd() < 0.5 ? -1 : 1) * (mediaBorde + 3 + rnd() * 9);
    if (z > 0 && x > -45 && x < 0) continue; // dejar libre la vista de la cámara
    palmera(x, z, 6 + rnd() * 4);
  }

  // Caño de la Auyama: agua ancha con manglar
  const manglar = new THREE.MeshStandardMaterial({ color: "#2f5a2a", roughness: 0.85 });
  for (let i = 0; i < 70; i++) {
    const lado = rnd() < 0.5 ? -1 : 1;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rnd() * 3, 1), manglar);
    m.position.set(xFin + 8 + rnd() * 120, fondoY + 1.4 + rnd() * 1.2, lado * (23 + rnd() * 30));
    m.scale.y = 0.6;
    scene.add(m);
  }

  // ---- Agua (sube y baja con el nivel; olas animadas) ----
  // Agua de arroyo cargada de sedimento (mate) y agua de manglar del caño (más oscura).
  const aguaMat = new THREE.MeshPhysicalMaterial({ color: "#5a4628", roughness: 0.42, metalness: 0.0, clearcoat: 0.15 });
  const canoMat = new THREE.MeshPhysicalMaterial({ color: "#3d3a22", roughness: 0.3, metalness: 0.0, clearcoat: 0.3 });
  const canalGeo = new THREE.PlaneGeometry(largoCanal + 1, 2 * mediaBorde, 160, 14);
  canalGeo.rotateX(-Math.PI / 2);
  canalGeo.translate((xIni + xFin) / 2, 0, 0);
  const aguaCanal = new THREE.Mesh(canalGeo, aguaMat);
  aguaCanal.receiveShadow = true;
  const canoGeo = new THREE.PlaneGeometry(160, 120, 60, 40);
  canoGeo.rotateX(-Math.PI / 2);
  canoGeo.translate(xFin + 80, 0, 0);
  const aguaCano = new THREE.Mesh(canoGeo, canoMat);
  scene.add(aguaCanal, aguaCano);
  const base = [canalGeo, canoGeo].map((g) => Float32Array.from(g.attributes.position.array));

  // Las olas del canal avanzan a la velocidad del agua (fase = k·x − k·v·t).
  const ola = { t: 0, v: 0, amp: 0.05 };
  const alturaOla = (x, z) => ola.amp * (Math.sin(0.9 * (x - ola.v * ola.t)) * 0.6 + Math.sin(x * 0.37 + z * 1.3 - ola.t * 1.3) * 0.4);
  const agua = {
    y: fondoY + 0.15,
    yCano: fondoY + 0.6,
    /** nivel del arroyo (m sobre el fondo) y del caño, que lo controla el Magdalena */
    setNivel(m, mCano = 0.6) { this.y = fondoY + m; this.yCano = fondoY + Math.max(mCano, Math.min(m, mCano)); },
    alturaEn(x, z) { return (x < xFin ? this.y : this.yCano) + (x < xFin ? alturaOla(x, z) : 0); },
    animar(t, velFlujo, lluvia) {
      ola.t = t; ola.v = velFlujo; ola.amp = 0.04 + 0.03 * Math.min(2, velFlujo) + 0.02 * lluvia;
      [canalGeo, canoGeo].forEach((g, k) => {
        const p = g.attributes.position.array, b = base[k];
        const y0 = k === 0 ? this.y : this.yCano;
        for (let i = 0; i < p.length; i += 3) {
          const x = b[i], z = b[i + 2];
          p[i + 1] = y0 + (k === 0 ? alturaOla(x, z) : 0.03 * Math.sin(x * 0.3 + z * 0.2 - t * 0.6));
        }
        g.attributes.position.needsUpdate = true;
        g.computeVertexNormals();
      });
    },
  };

  // ---- Lluvia ----
  const N_GOTAS = baja ? 2500 : 6000;
  const gotasGeo = new THREE.BufferGeometry();
  const gp = new Float32Array(N_GOTAS * 6);
  for (let i = 0; i < N_GOTAS; i++) {
    const x = -50 + Math.random() * 80, y = Math.random() * 30 - 3, z = -25 + Math.random() * 50;
    gp.set([x, y, z, x + 0.05, y - 0.55, z], i * 6);
  }
  gotasGeo.setAttribute("position", new THREE.BufferAttribute(gp, 3));
  const lluvia = new THREE.LineSegments(gotasGeo, new THREE.LineBasicMaterial({ color: "#c8d4e0", transparent: true, opacity: 0.45 }));
  lluvia.frustumCulled = false;
  scene.add(lluvia);
  const lluviaFx = {
    actualizar(dtReal, mmMin) {
      const visibles = Math.min(N_GOTAS, Math.round((mmMin / 3.2) * N_GOTAS));
      gotasGeo.setDrawRange(0, visibles * 2);
      const p = gotasGeo.attributes.position.array;
      for (let i = 0; i < visibles; i++) {
        const k = i * 6;
        p[k + 1] -= 9 * dtReal; p[k + 4] -= 9 * dtReal; // velocidad terminal de una gota: ~9 m/s
        if (p[k + 4] < agua.y) { const y = 27 + Math.random() * 3; p[k + 1] = y; p[k + 4] = y - 0.55; }
      }
      gotasGeo.attributes.position.needsUpdate = true;
      // Nubes: el cielo se apaga y la niebla sube con la lluvia
      const k = Math.min(1, mmMin / 2);
      sky.material.uniforms.turbidity.value = lerp(2, 18, k);
      sky.material.uniforms.rayleigh.value = lerp(1.2, 0.2, k);
      solLuz.intensity = lerp(2.6, 0.5, k);
      hemi.intensity = lerp(0.7, 0.45, k);
      scene.fog.density = lerp(0.004, 0.016, k);
      scene.fog.color.setRGB(lerp(0.79, 0.55, k), lerp(0.83, 0.58, k), lerp(0.86, 0.62, k));
    },
  };

  // ---- Barreras flotantes (canalizan la basura hacia la boca) ----
  const boyaMats = ["#f2a516", "#e8e2d0"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
  const barreras = new THREE.Group();
  scene.add(barreras);
  const puntaX = RAMPA.bisagraX - RAMPA.largo * Math.cos((25 * Math.PI) / 180);
  const barrera = (lado) => {
    const a = new THREE.Vector3(-24, 0, lado * 4.9), b = new THREE.Vector3(puntaX - 0.2, 0, lado * 1.35);
    const n = 26;
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / n);
      const boya = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, (a.distanceTo(b) / n) * 0.92, 12), boyaMats[i % 2]);
      boya.rotation.z = Math.PI / 2;
      boya.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      boya.position.copy(p);
      boya.castShadow = true;
      barreras.add(boya);
    }
  };
  barrera(-1); barrera(1);
  const barreraZ = (x) => { // ancho libre entre barreras en x (para la física de la basura)
    if (x < -24 || x > puntaX) return null;
    return lerp(4.9, 1.35, (x + 24) / (puntaX + 24));
  };

  // ---- Los 5 ojos (postes con radar sobre el canal) ----
  const ojos = [];
  const xsOjos = [-70, -44, -34, -24, -15];
  const gris = new THREE.MeshStandardMaterial({ color: "#c9cdd2", roughness: 0.5, metalness: 0.3 });
  xsOjos.forEach((x, i) => {
    const g = new THREE.Group();
    const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 10), gris);
    poste.position.y = 1.6;
    const brazo = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.9), gris);
    brazo.position.set(0, 2.9, 0.95);
    const radar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.18, 16), new THREE.MeshStandardMaterial({ color: "#eee", roughness: 0.4 }));
    radar.position.set(0, 2.78, 1.85);
    const caja = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.18), new THREE.MeshStandardMaterial({ color: "#dcdcdc", roughness: 0.6 }));
    caja.position.set(0, 2.1, 0.12);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.4), unaVez("matPanelOjo", () => new THREE.MeshStandardMaterial({ map: unaVez("panel", texPanel), roughness: 0.3, metalness: 0.4 })));
    panel.position.set(0, 3.25, 0); panel.rotation.x = 0.35;
    const luz = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8), new THREE.MeshStandardMaterial({ color: "#111", emissive: "#00ff40", emissiveIntensity: 2 }));
    luz.position.set(0, 3.45, 0);
    for (const m of [poste, brazo, radar, caja, panel]) { m.castShadow = true; g.add(m); }
    g.add(luz);
    const l = etiqueta(`Ojo ${i + 1}`, "ojo");
    l.position.set(0, 4.1, 0);
    g.add(l);
    g.position.set(x, 0, -(mediaBorde + 0.2));
    scene.add(g);
    ojos.push({ grupo: g, luz, etiqueta: l });
  });

  // ---- Escala humana: vecinos, una señal de peligro y un carro ----
  const ropa = ["#2b5fab", "#c23b3b", "#f2c14e", "#3e8e5a", "#7a4ea3", "#e07b39"];
  const piel = ["#8d5a3b", "#c48a62", "#6b3f26", "#e0b48f"];
  const persona = (x, z, i) => {
    const g = new THREE.Group();
    const cuerpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 8), new THREE.MeshStandardMaterial({ color: ropa[i % ropa.length], roughness: 0.8 }));
    cuerpo.position.y = 0.75;
    const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshStandardMaterial({ color: piel[i % piel.length], roughness: 0.7 }));
    cabeza.position.y = 1.58;
    for (const m of [cuerpo, cabeza]) { m.castShadow = !baja; g.add(m); }
    g.position.set(x, 0.25, z);
    scene.add(g);
  };
  [[-60, 6.6], [-58, 6.9], [-49, 3.5], [-47, -3.2], [-20, -6.8], [-6, 6.8], [4, 7.1], [16, -6.7], [-35, 6.7]].forEach(([x, z], i) => persona(x, z, i));
  const senal = new THREE.Group();
  const posteS = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 8), gris);
  posteS.position.y = 1.2;
  const placa = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshBasicMaterial({ map: lienzo(256, 176, (g, w, h) => {
    g.fillStyle = "#f2c200"; g.fillRect(0, 0, w, h); g.strokeStyle = "#111"; g.lineWidth = 10; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = "#111"; g.font = "bold 46px Helvetica, Arial"; g.textAlign = "center"; g.fillText("PELIGRO", w / 2, 74); g.font = "bold 34px Helvetica, Arial"; g.fillText("ARROYO", w / 2, 128);
  }), side: THREE.DoubleSide }));
  placa.position.y = 2.2;
  placa.rotation.y = Math.PI / 2;
  senal.add(posteS, placa);
  senal.position.set(-66, 0, -(mediaBorde + 1.2));
  scene.add(senal);
  const carro = new THREE.Group();
  const chasis = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 1.8), new THREE.MeshStandardMaterial({ color: "#c9302c", roughness: 0.4, metalness: 0.3 }));
  chasis.position.y = 0.75;
  const cabina = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 1.6), new THREE.MeshStandardMaterial({ color: "#2a3440", roughness: 0.2 }));
  cabina.position.set(-0.2, 1.5, 0);
  for (const m of [chasis, cabina]) { m.castShadow = !baja; carro.add(m); }
  carro.position.set(-28, 0, 11);
  scene.add(carro);

  // ---- La estación: el caimán ----
  const est = construirCaiman();
  scene.add(est.grupo);

  return { scene, camera, agua, lluviaFx, ojos, est, barreras, barreraZ, puntaXCerrada: puntaX };
}

function construirCaiman() {
  const grupo = new THREE.Group();
  const escamas = texEscamas();
  const piel = new THREE.MeshPhysicalMaterial({ color: "#4d5230", map: escamas, bumpMap: escamas, bumpScale: 4, roughness: 0.6, clearcoat: 0.4, clearcoatRoughness: 0.4 });
  piel.map.repeat.set(1, 1);
  const pieles = [piel];
  const vientre = new THREE.MeshStandardMaterial({ color: "#c9bd88", roughness: 0.7 });

  // Casco / cuerpo: de x=-3 (cuello) a x=8, cola hasta x=16
  const casco = new THREE.Mesh(cuerpoGeo({ largo: 11.5, ancho0: 1.9, ancho1: 1.5, alto0: 1.5, alto1: 1.2, bajo: 0.45, puntaRedonda: 0.3 }), piel);
  casco.position.set(-3.2, 0, 0);
  casco.castShadow = casco.receiveShadow = true;
  grupo.add(casco);
  const cola = new THREE.Mesh(cuerpoGeo({ largo: 8, ancho0: 1.3, ancho1: 0.12, alto0: 1.0, alto1: 0.2, bajo: 0.6, puntaRedonda: 0 },
    (X, Y, Z, u) => [X, Y + Math.sin(u * 3) * 0.1, Z + Math.sin(u * 2.4) * 0.6 * u]), piel);
  cola.position.set(8, 0.1, 0);
  cola.castShadow = true;
  grupo.add(cola);
  // Escudos (osteodermos) en dos filas sobre el lomo y la cola
  const escudo = new THREE.ConeGeometry(0.18, 0.35, 4);
  for (let x = -2.4; x < 15; x += 0.6) {
    for (const z of x < 8 ? [-1.05, 1.05] : [-0.25, 0.25]) {
      const k = x < 8 ? 1 : 1 - (x - 8) / 9;
      const e = new THREE.Mesh(escudo, piel);
      const y = x < 8 ? 1.42 : 0.95 * k + 0.15;
      e.position.set(x, y, z * (x < 8 ? 1 : k + 0.3) + (x > 8 ? Math.sin(((x - 8) / 8) * 2.4) * 0.6 * ((x - 8) / 8) : 0));
      e.scale.setScalar(k);
      e.castShadow = true;
      grupo.add(e);
    }
  }
  // Patas (flotadores estabilizadores)
  for (const [x, z] of [[-1, -1.9], [-1, 1.9], [5.5, -1.7], [5.5, 1.7]]) {
    const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.2, 6, 12), piel);
    p.rotation.set(Math.sign(z) * 0.9, 0, 0.3);
    p.position.set(x, -0.15, z * 1.12);
    p.castShadow = true;
    grupo.add(p);
  }
  // Lomo solar
  const panelMat = new THREE.MeshStandardMaterial({ map: unaVez("panel", texPanel), roughness: 0.25, metalness: 0.5 });
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 1.7), panelMat);
    p.position.set(-1.2 + i * 1.45, 1.62, 0);
    p.castShadow = true;
    grupo.add(p);
  }

  // Cabeza: pivote en la bisagra; la mandíbula inferior es la rampa con la banda.
  const cabeza = new THREE.Group();
  cabeza.position.set(RAMPA.bisagraX, 0.55, 0);
  grupo.add(cabeza);

  const { largo: L, ancho: A } = RAMPA;
  // Rampa: marco + banda
  const marcoMat = new THREE.MeshStandardMaterial({ color: "#3b4024", roughness: 0.6, metalness: 0.2 });
  for (const z of [-A / 2, A / 2]) {
    const lado = new THREE.Mesh(new THREE.BoxGeometry(L, 0.55, 0.14), marcoMat);
    lado.position.set(-L / 2, 0.05, z);
    lado.castShadow = true;
    cabeza.add(lado);
  }
  const texB = texBanda();
  texB.repeat.set(1, L / 0.8);
  const banda = new THREE.Mesh(new THREE.PlaneGeometry(A - 0.2, L), new THREE.MeshStandardMaterial({ map: texB, roughness: 0.85 }));
  banda.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  banda.position.set(-L / 2, 0.22, 0);
  banda.receiveShadow = true;
  cabeza.add(banda);
  // Rejilla = dientes de la mandíbula inferior (peine que deja pasar el agua)
  const dienteMat = new THREE.MeshStandardMaterial({ color: "#e8e1c8", roughness: 0.4 });
  for (let x = -L + 0.25; x < -0.3; x += 0.32) {
    for (const z of [-A / 2, A / 2]) {
      const d = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 6), dienteMat);
      d.position.set(x, 0.45, z);
      cabeza.add(d);
    }
  }
  // Barrera infrarroja (contador) al final de la banda
  const hazMat = new THREE.MeshBasicMaterial({ color: "#ff2020", transparent: true, opacity: 0.8 });
  const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, A, 6), hazMat);
  haz.rotation.x = Math.PI / 2;
  haz.position.set(-0.45, 0.42, 0);
  cabeza.add(haz);
  for (const z of [-A / 2, A / 2]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: "#222" }));
    s.position.set(-0.45, 0.42, z * 0.98);
    cabeza.add(s);
  }

  // Cráneo (mandíbula superior), con su propio pivote para la boca.
  const craneoPiv = new THREE.Group();
  craneoPiv.position.set(0.2, 0.75, 0);
  cabeza.add(craneoPiv);
  const craneo = new THREE.Mesh(cuerpoGeo({ largo: 5.6, ancho0: 1.55, ancho1: 1.0, alto0: 1.0, alto1: 0.35, bajo: 0.12, puntaRedonda: 0.9 },
    (X, Y, Z, u, v) => {
      if (v > 0) for (const sd of [-1, 1]) Y += 0.55 * v * Math.exp(-((X - 1.1) ** 2) / 0.35 - ((Z - sd * 0.8) ** 2) / 0.12); // torretas de los ojos
      if (v > 0) Y += 0.2 * v * Math.exp(-((X - 5.2) ** 2 + Z * Z) / 0.15); // narinas
      return [X, Y, Z];
    }), piel);
  craneo.rotation.y = Math.PI; // apunta aguas arriba (−X)
  craneo.castShadow = true;
  craneoPiv.add(craneo);
  for (let x = 0.6; x < 5.2; x += 0.34) {
    for (const z of [-1, 1]) {
      const u = x / 5.6, hw = lerp(1.0, 1.55, 1 - smooth(0.05, 1, u)) * 0.92 * (1 - Math.pow(u, 6) * 0.5);
      const d = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 6), dienteMat);
      d.rotation.x = Math.PI;
      d.position.set(-x, -0.22, z * hw);
      craneoPiv.add(d);
    }
  }
  // Ojos = tira LED RGB detrás de domos
  const ojos = [];
  for (const z of [-0.8, 0.8]) {
    const mat = new THREE.MeshPhysicalMaterial({ color: "#200", emissive: "#00ff40", emissiveIntensity: 0, roughness: 0.05, clearcoat: 1 });
    const o = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 12), mat);
    o.position.set(-1.1, 0.95, z);
    o.scale.set(1.2, 0.75, 1);
    const luz = new THREE.PointLight("#00ff40", 0, 9, 2);
    luz.position.set(-1.4, 1.3, z * 1.3);
    craneoPiv.add(o, luz);
    ojos.push({ malla: o, luz });
  }
  // Parlante del rugido + ondas
  const parlante = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 16, 1, true), new THREE.MeshStandardMaterial({ color: "#222", side: THREE.DoubleSide }));
  parlante.rotation.z = Math.PI / 2;
  parlante.position.set(-0.3, 1.0, 0);
  craneoPiv.add(parlante);
  const ondas = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: "#ffd0a0", transparent: true, opacity: 0 }));
    m.rotation.y = Math.PI / 2;
    m.position.set(-0.6, 1.0, 0);
    craneoPiv.add(m);
    return m;
  });

  // Panza: contenedor de basura (visible en modo componentes)
  const panza = new THREE.Group();
  panza.position.set(0.6, 0.3, 0);
  grupo.add(panza);
  const caja = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 2.4), new THREE.MeshStandardMaterial({ color: "#56606b", transparent: true, opacity: 0.6 }));
  const relleno = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1, 2.3), new THREE.MeshStandardMaterial({ color: "#c7c2b0", roughness: 1 }));
  relleno.scale.y = 0.01;
  relleno.position.y = -0.5;
  panza.add(caja, relleno);

  const etiquetas = [
    ["Boca: rampa + banda (servo D9 · motor D3)", cabeza, new THREE.Vector3(-2.5, 1.3, 0)],
    ["Barrera IR · D2", cabeza, new THREE.Vector3(-0.45, 0.9, 1.4)],
    ["Luces de los ojos (RGB) · D5/D6/D11", craneoPiv, new THREE.Vector3(-1.1, 1.6, 0)],
    ["Rugido · D8", craneoPiv, new THREE.Vector3(-0.3, 1.5, -0.6)],
    ["Panza (contenedor)", panza, new THREE.Vector3(0, 1.2, 0)],
    ["Lomo solar", grupo, new THREE.Vector3(3, 2.1, 0)],
  ].map(([t, padre, p]) => { const l = etiqueta(t); l.position.copy(p); padre.add(l); return l; });

  function setComponentes(on) {
    for (const m of pieles) { m.transparent = on; m.opacity = on ? 0.3 : 1; m.depthWrite = !on; m.needsUpdate = true; }
    for (const l of etiquetas) l.visible = on;
    caja.visible = relleno.visible = on;
  }
  setComponentes(false);

  return { grupo, cabeza, craneoPiv, banda, texBanda: texB, haz, hazMat, ojos, ondas, relleno, setComponentes };
}
