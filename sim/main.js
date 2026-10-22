// Simulador: aguacero -> ojos -> cerebro -> estación (código real) -> hardware virtual -> 3D.
// La física de la basura vive en sim/rio.js y la demo del aguacero en src/demo.js;
// este archivo solo los une con la escena 3D y la interfaz.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { construirEscena } from "./escena.js";
import { crearRio, rampaEnElMundo, RAMPA } from "./rio.js";
import { VirtualWorld, createVirtualFive, mulberry32 } from "./virtual-five.js";
import { crearEstacion } from "../src/estacion.js";
import { NIVELES } from "../src/cerebro.js";
import { OJOS_DEMO, OJO_CAIMAN, velocidadFlujo, nivelCanoM } from "../src/aguacero.js";
import { crearDemo, mmss } from "../src/demo.js";
import { CONFIG, UMBRALES } from "../src/config.js";

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const IR = CONFIG.pines.contadorIR;
const COLOR = { VERDE: "#2ecc71", AMARILLO: "#f5c400", NARANJA: "#ff7a1a", ROJO: "#ff3b3b", SIN_DATOS: "#3d8bff" };
const COLOR_OJO = ["#8fd3ff", "#c9a8ff", "#ffd27a", "#7fe0b0", "#ffffff"];
const ALERTA_TXT = { VERDE: "VERDE", AMARILLO: "AMARILLA", NARANJA: "NARANJA", ROJO: "ROJA" };
// Mensajes al público: PROVISIONALES, a redactar con la Oficina de Gestión del Riesgo.
const CONSEJO = {
  VERDE: "Sin peligro por ahora.",
  AMARILLO: "Llueve fuerte aguas arriba: esté atento.",
  NARANJA: "El arroyo está subiendo: aléjese de la orilla.",
  ROJO: "Arroyo crecido: no lo cruce ni a pie ni en carro.",
};
const NOMBRE_MODO = {
  CAPTURA: "El caimán está comiendo basura",
  ALIVIO: "El caimán levanta la cabeza para dejar pasar el agua",
  ATASCO: "Algo se trabó en la banda",
  SIN_DATOS: "No llegan datos de los ojos",
  ALIVIO_SIN_DATOS: "Sin datos: abre la boca por seguridad",
};
const PLURAL = { botella: "botellas", bolsa: "bolsas", icopor: "icopor", lata: "latas", chancla: "chanclas" };
// Números a la colombiana: coma decimal.
const num = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");

const params = new URLSearchParams(location.search);
const calidad = params.get("calidad") || (matchMedia("(pointer: coarse)").matches ? "baja" : "alta");
const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
const semilla = Number(params.get("semilla")) || ((Math.random() * 1e9) >>> 0);

// ---- Render ------------------------------------------------------------------
const vista = $("vista");
const renderer = new THREE.WebGLRenderer({ antialias: calidad !== "baja" });
renderer.setPixelRatio(Math.min(calidad === "baja" ? 1.25 : 2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = calidad === "baja" ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
vista.prepend(renderer.domElement);
const etiquetas = new CSS2DRenderer({ element: $("etiquetas") });
const E = construirEscena(renderer, { calidad, cotaM: UMBRALES.ojos[OJO_CAIMAN - 1].cotaDesbordeCm / 100 });
const controles = new OrbitControls(E.camera, renderer.domElement);
controles.target.set(-6, -1.2, 0);
controles.enableDamping = true;
controles.maxPolarAngle = Math.PI * 0.48;
controles.minDistance = 6;
controles.maxDistance = 140;
function redimensionar() {
  const w = vista.clientWidth, h = vista.clientHeight;
  renderer.setSize(w, h); etiquetas.setSize(w, h);
  E.camera.aspect = w / h; E.camera.updateProjectionMatrix();
}
new ResizeObserver(redimensionar).observe(vista);
redimensionar();

// ---- Estado de la simulación ----------------------------------------------------
const ajustes = { velocidad: 20, pausa: true, voltaje: 6.0, alim: "externa", masaKg: 0.35, cortada: false, atasco: false, sonido: false, componentes: false };
const demo = crearDemo();
const estado = { rio: null, tS: 0, historiaAlerta: [], acumSpawn: 0, tPrimerAviso: null, tDesborde: null, reinicioEn: null, nivelAnunciado: 0 };
let world, five, board, est;

function log(msg, cls = "") {
  const el = $("consola"), d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = msg;
  el.append(d);
  while (el.childElementCount > 300) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}

function arrancarPlaca() {
  est = null;
  $("caida").classList.remove("ver");
  world = new VirtualWorld({ seed: semilla, voltajeServo: ajustes.voltaje, alimentacion: ajustes.alim, rampaMasaKg: ajustes.masaKg });
  world.setDigital(IR, 1);
  world.on("warning", (m) => log(`⚠ ${m}`, "aviso"));
  world.on("brownout", ({ amps }) => { log(`✖ CAÍDA DE TENSIÓN a ${num(amps, 2)} A: el Arduino se reinició y dejó de obedecer`, "error"); $("caida").classList.add("ver"); });
  five = createVirtualFive(world);
  board = new five.Board();
  board.on("error", () => {});
  board.on("close", () => log("✖ La placa ya no responde (en la maqueta real, hardware/run.js se detiene aquí)", "error"));
  log("Placa conectada, saludo Firmata…");
  board.on("ready", () => {
    // ↓↓↓ exactamente lo que hace hardware/run.js en la maqueta real ↓↓↓
    est = crearEstacion(five, board, CONFIG, { log: (m) => log(m), reloj: () => world.time });
  });
}

function reiniciarTodo() {
  demo.reiniciar();
  for (const b of estado.rio?.basura || []) E.scene.remove(b.malla);
  Object.assign(estado, {
    rio: crearRio({ barreraZ: E.barreraZ, rng: mulberry32(semilla) }),
    tS: 0, historiaAlerta: [], acumSpawn: 0, tPrimerAviso: null, tDesborde: null, reinicioEn: null, nivelAnunciado: 0,
  });
  $("consola").textContent = "";
  $("nuevo").hidden = true;
  log(`Semilla de la basura: ${semilla} (repetir con ?semilla=${semilla})`);
  arrancarPlaca();
  document.querySelectorAll(".ojoBtn").forEach((b) => { b.setAttribute("aria-pressed", "false"); b.textContent = "Apagar"; b.classList.remove("on"); });
}

// ---- Basura: la física está en sim/rio.js; aquí solo su aspecto -------------------
const ASPECTO = {
  botella: { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.42, 10).rotateZ(Math.PI / 2), mats: ["#a9dcef", "#7fc8a9", "#e9f3f7"] },
  bolsa: { geo: new THREE.SphereGeometry(0.22, 10, 6).scale(1.3, 0.3, 1), mats: ["#f4f4f4", "#1d1d1d", "#2f6fd1"] },
  icopor: { geo: new THREE.BoxGeometry(0.34, 0.1, 0.24), mats: ["#fbfbf6"] },
  lata: { geo: new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10).rotateX(Math.PI / 2), mats: ["#b8bcc2", "#c8252b"] },
  chancla: { geo: new THREE.BoxGeometry(0.3, 0.04, 0.11), mats: ["#3aa655", "#e2a000"] },
};
const matCache = new Map();
const mat = (c) => matCache.get(c) || matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 })).get(c);
const llanta = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.14, 10, 24), new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.8 }));
llanta.visible = false;
E.scene.add(llanta);

function soltarBasura(nivelM) {
  const b = estado.rio.soltar(nivelM);
  const a = ASPECTO[b.tipo.nombre];
  b.malla = new THREE.Mesh(a.geo, mat(a.mats[b.color % a.mats.length]));
  b.malla.rotation.y = b.giro;
  E.scene.add(b.malla);
}
function quitarMallas() {
  for (const b of estado.rio.tomarRemovidos()) if (b.malla) E.scene.remove(b.malla);
}

const rampaMundo = () => {
  const servo = world.servos[0];
  return rampaEnElMundo((servo ? servo.grados : CONFIG.compuerta.abiertaDeg) - world.rampaOffsetDeg, E.agua.y);
};
const S_HAZ = RAMPA.largo - 0.45;

// ---- Sonido del rugido (Web Audio) ------------------------------------------------
let audio = null;
function rugidoAudio(on) {
  if (!ajustes.sonido) { if (audio) audio.g.gain.value = 0; return; }
  if (!audio) {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.value = 62; lfo.frequency.value = 9; lg.gain.value = 18;
    lfo.connect(lg).connect(o.frequency);
    f.type = "lowpass"; f.frequency.value = 420;
    g.gain.value = 0;
    o.connect(f).connect(g).connect(ctx.destination);
    o.start(); lfo.start();
    audio = { ctx, g };
  }
  audio.g.gain.setTargetAtTime(on ? 0.35 : 0, audio.ctx.currentTime, 0.03);
}

// ---- Interfaz -----------------------------------------------------------------------
const alternar = (id, on, textoOn, textoOff) => {
  const b = $(id);
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", String(on));
  if (textoOn) b.textContent = on ? textoOn : textoOff;
};
function activarSonido(on) {
  ajustes.sonido = on;
  alternar("sonido", on, "Sonido: sí", "Sonido: no");
  if (on) rugidoAudio(false);
}
$("empezar").onclick = () => {
  $("intro").hidden = true;
  activarSonido(true); // el clic del visitante permite el audio
  ajustes.pausa = false;
  $("play").textContent = "Pausar";
};
$("play").onclick = () => {
  if (!$("intro").hidden) { $("empezar").click(); return; }
  ajustes.pausa = !ajustes.pausa;
  $("play").textContent = ajustes.pausa ? "Seguir" : "Pausar";
};
$("velocidad").onchange = (e) => (ajustes.velocidad = +e.target.value);
$("reiniciar").onclick = () => reiniciarTodo();
$("sonido").onclick = () => activarSonido(!ajustes.sonido);
$("voltaje").onchange = (e) => { ajustes.voltaje = +e.target.value; world.voltajeServo = ajustes.voltaje; log(`Servo alimentado a ${num(ajustes.voltaje)} V`); };
$("alim").onchange = (e) => {
  ajustes.alim = e.target.value; world.alimentacion = ajustes.alim;
  log(ajustes.alim === "arduino5v" ? "⚠ Servo y motor ahora toman del pin 5 V del Arduino (≈500 mA máx.)" : "Servo y motor con fuentes externas", ajustes.alim === "arduino5v" ? "aviso" : "");
};
$("masa").oninput = (e) => { ajustes.masaKg = e.target.value / 1000; world.rampaMasaKg = ajustes.masaKg; $("masaOut").textContent = `${e.target.value} g`; };
$("componentes").onclick = () => { ajustes.componentes = !ajustes.componentes; E.est.setComponentes(ajustes.componentes); alternar("componentes", ajustes.componentes); };
$("atasco").onclick = () => {
  ajustes.atasco = !ajustes.atasco;
  alternar("atasco", ajustes.atasco, "Retirar la llanta", "Atascar la banda con una llanta");
  log(ajustes.atasco ? "Falla: una llanta se trabó al final de la banda" : "Llanta retirada", ajustes.atasco ? "aviso" : "");
};
$("cortar").onclick = () => {
  ajustes.cortada = !ajustes.cortada;
  alternar("cortar", ajustes.cortada, "Reconectar con el cerebro", "Cortar la conexión con el cerebro");
  log(ajustes.cortada ? "Falla: no llega GET /alerta (WiFi o servidor caído)" : "Conexión con el cerebro restablecida", ajustes.cortada ? "aviso" : "");
};
$("reset").onclick = () => { log("— reinicio de la placa —"); arrancarPlaca(); };
$("caidaArreglar").onclick = () => { ajustes.alim = "externa"; $("alim").value = "externa"; log("— fuentes externas, placa reiniciada —"); arrancarPlaca(); };

const lista = $("ojosLista");
UMBRALES.ojos.forEach((o, i) => {
  const d = document.createElement("div");
  d.innerHTML = `<span class="punto" id="p${o.id}" style="border-color:${COLOR_OJO[i]}"></span><span>${o.nombre}<br><em id="m${o.id}">–</em></span><b id="n${o.id}" class="dato">–</b><button type="button" class="ojoBtn falla" data-id="${o.id}" aria-pressed="false">Apagar</button>`;
  lista.append(d);
});
lista.addEventListener("click", (e) => {
  const b = e.target.closest(".ojoBtn");
  if (!b) return;
  const id = +b.dataset.id, apagar = !demo.fuente.ojoApagado(id);
  demo.fuente.apagarOjo(id, apagar);
  b.setAttribute("aria-pressed", String(apagar));
  b.textContent = apagar ? "Encender" : "Apagar";
  b.classList.toggle("on", apagar);
  log(apagar ? `Falla: el ojo ${id} dejó de enviar (batería o radio)` : `El ojo ${id} vuelve a enviar`, apagar ? "aviso" : "");
});

// ---- Gráfica de 60 min: nivel de cada ojo como % de SU nivel de peligro --------------------
// La franja de alerta lleva color Y patrón (para quien no distingue rojo de verde):
// VERDE liso · AMARILLO rayas diagonales · NARANJA puntos · ROJO cuadriculado · SIN DATOS rayas horizontales.
const graf = $("grafica"), gg = graf.getContext("2d");
function patronAlerta(nivel) {
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d");
  g.fillStyle = COLOR[nivel]; g.fillRect(0, 0, 8, 8);
  g.strokeStyle = g.fillStyle = "rgba(0,0,0,.55)"; g.lineWidth = 1.5;
  if (nivel === "AMARILLO") { g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke(); }
  if (nivel === "NARANJA") { g.beginPath(); g.arc(4, 4, 1.6, 0, 7); g.fill(); }
  if (nivel === "ROJO") { g.beginPath(); g.moveTo(0, 4); g.lineTo(8, 4); g.moveTo(4, 0); g.lineTo(4, 8); g.stroke(); }
  if (nivel === "SIN_DATOS") { g.beginPath(); g.moveTo(0, 2); g.lineTo(8, 2); g.moveTo(0, 6); g.lineTo(8, 6); g.stroke(); }
  return gg.createPattern(c, "repeat");
}
const PATRON = Object.fromEntries(["VERDE", "AMARILLO", "NARANJA", "ROJO", "SIN_DATOS"].map((n) => [n, patronAlerta(n)]));
let GW = 0, GH = 0;
new ResizeObserver(() => {
  const r = graf.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  GW = r.width; GH = r.height;
  graf.width = Math.round(r.width * d); graf.height = Math.round(r.height * d);
  gg.setTransform(d, 0, 0, d, 0, 0);
}).observe(graf);
function dibujarGrafica() {
  if (!GW) return;
  const ag = demo.ag, tS = estado.tS;
  const W = GW, H = GH, izq = 30, der = 30, arriba = 14, banda = 12, abajo = 18 + banda, total = 3600, maxPct = 130;
  const x = (t) => izq + (t / total) * (W - izq - der);
  const y = (pct) => H - abajo - (pct / maxPct) * (H - abajo - arriba);
  gg.clearRect(0, 0, W, H);
  gg.font = "11px ui-monospace, Menlo, monospace";
  gg.textBaseline = "middle";
  // rejilla y eje
  gg.strokeStyle = "#2a3038"; gg.lineWidth = 1; gg.fillStyle = "#8e959f"; gg.textAlign = "right";
  for (const p of [0, 50, 100]) { gg.beginPath(); gg.moveTo(izq, y(p)); gg.lineTo(W - der, y(p)); gg.stroke(); gg.fillText(`${p}%`, izq - 4, y(p)); }
  // lluvia (eje derecho, mm/min)
  const ly = (mm) => H - abajo - (mm / 4) * (H - abajo - arriba) * 0.45;
  gg.fillStyle = "rgba(91,127,166,.55)";
  for (let t = 0; t < total; t += 30) { const mm = ag.lluviaMmMin(t); gg.fillRect(x(t), ly(mm), x(30) - x(0) - 1, H - abajo - ly(mm)); }
  gg.fillStyle = "#7f9fc4"; gg.textAlign = "left";
  gg.fillText("4", W - der + 4, ly(4)); gg.fillText("mm/min", W - der - 46, ly(4) - 10);
  // nivel de peligro
  gg.strokeStyle = "#ff3b3b"; gg.setLineDash([6, 4]); gg.lineWidth = 1.5;
  gg.beginPath(); gg.moveTo(izq, y(100)); gg.lineTo(W - der, y(100)); gg.stroke(); gg.setLineDash([]);
  gg.fillStyle = "#ff8a8a"; gg.fillText("nivel de peligro (provisional)", izq + 4, y(100) - 8);
  // curvas: lo medido entero, lo que viene atenuado
  OJOS_DEMO.forEach((o, i) => {
    const cota = UMBRALES.ojos[i].cotaDesbordeCm;
    const pct = (t) => (100 * ag.nivelCm(o.id, t)) / cota;
    for (const [desde, hasta, alfa] of [[0, tS, 1], [tS, total, 0.25]]) {
      if (hasta <= desde) continue;
      gg.globalAlpha = alfa; gg.strokeStyle = COLOR_OJO[i]; gg.lineWidth = i === OJO_CAIMAN - 1 ? 2.5 : 1.5;
      gg.beginPath();
      for (let t = desde; t <= hasta; t += 20) { const v = y(Math.min(maxPct, pct(t))); t === desde ? gg.moveTo(x(t), v) : gg.lineTo(x(t), v); }
      gg.stroke();
    }
    gg.globalAlpha = 1;
    let tp = 0; for (let t = 0; t < total; t += 20) if (pct(t) > pct(tp)) tp = t;
    gg.fillStyle = COLOR_OJO[i]; gg.textAlign = "center";
    gg.fillText(`${o.id}`, x(tp), y(Math.min(maxPct, pct(tp))) - 8);
  });
  // franja de alerta (color + patrón) y "ahora"
  for (const h of estado.historiaAlerta) { gg.fillStyle = PATRON[h.sinDatos ? "SIN_DATOS" : h.nivel]; gg.fillRect(x(h.t), H - banda - 2, x(5) - x(0) + 1, banda); }
  gg.strokeStyle = "#58c4ff"; gg.setLineDash([3, 3]); gg.lineWidth = 1.5;
  gg.beginPath(); gg.moveTo(x(tS), arriba - 8); gg.lineTo(x(tS), H - banda - 2); gg.stroke(); gg.setLineDash([]);
  gg.fillStyle = "#8e959f"; gg.textAlign = "center";
  for (const m of [0, 15, 30, 45, 60]) gg.fillText(`${m} min`, Math.min(W - der - 12, Math.max(izq + 14, x(m * 60))), H - banda - 10);
}

// ---- Bucle principal ------------------------------------------------------------------------
let ultimo = performance.now(), hudAcc = 0, reloj = 0, rugidoVisualHasta = 0, pinPrevio = 0, sonando = false;

function cuadro(ahora) {
  requestAnimationFrame(cuadro);
  simularCuadro(ahora);
}

function simularCuadro(ahora) {
  const dtReal = Math.min(50, ahora - ultimo);
  ultimo = ahora;
  reloj += dtReal / 1000;
  const ag = demo.ag, rio = estado.rio;

  // Al terminar los 60 min, otro aguacero solo (modo feria).
  if (estado.tS >= demo.totalS && estado.reinicioEn === null) { estado.reinicioEn = reloj + 5; $("nuevo").hidden = false; }
  if (estado.reinicioEn !== null && reloj >= estado.reinicioEn) reiniciarTodo();
  let restante = ajustes.pausa || estado.reinicioEn !== null ? 0 : dtReal * ajustes.velocidad;
  let hazTapado = ajustes.atasco, vBanda = 0;

  while (restante > 0) {
    const h = Math.min(50, restante);
    restante -= h;
    estado.tS += h / 1000;
    const tS = estado.tS;
    const nivelM = ag.nivelCm(OJO_CAIMAN, tS) / 100;
    E.agua.setNivel(nivelM, nivelCanoM(nivelM));

    // El "servidor": los ojos envían, el cerebro decide; la estación consulta cada 5 s.
    const a = demo.tick(tS, est, { conectado: !ajustes.cortada });
    if (a) {
      estado.historiaAlerta.push({ t: tS, nivel: a.nivel, sinDatos: a.sinDatos });
      if (estado.tPrimerAviso === null && NIVELES.indexOf(a.nivel) >= NIVELES.indexOf("NARANJA")) estado.tPrimerAviso = tS;
    }
    if (estado.tDesborde === null && ag.nivelCm(OJO_CAIMAN, tS) >= UMBRALES.ojos[OJO_CAIMAN - 1].cotaDesbordeCm) estado.tDesborde = tS;
    // Basura que baja con el agua
    estado.acumSpawn += (ag.basuraObjMin(tS) / 60) * (h / 1000);
    while (estado.acumSpawn >= 1) { estado.acumSpawn -= 1; soltarBasura(nivelM); }
    const motor = world.motores[0];
    vBanda = motor ? (motor.rpm / 60) * Math.PI * 0.04 * Math.sqrt(5) : 0; // tambor de 4 cm, Froude 1:5
    const servo = world.servos[0];
    const r = rio.paso(h / 1000, {
      rampaDeg: (servo ? servo.grados : CONFIG.compuerta.abiertaDeg) - world.rampaOffsetDeg,
      aguaY: E.agua.y, vBanda, andando: vBanda > 0.03 && !ajustes.atasco,
      velFlujo: velocidadFlujo(nivelM), nivelM, t: tS, alturaEn: (x, z) => E.agua.alturaEn(x, z),
    });
    hazTapado = r.hazTapado || ajustes.atasco;
    world.cargaBanda = r.cargaBanda + (ajustes.atasco ? 1 : 0);
    world.setDigital(IR, hazTapado ? 0 : 1); // receptor IR: BAJO = haz cortado
    world.step(h);
    // El rugido dura 0,25–1,2 s de la maqueta; a ×20 se vería un parpadeo. En pantalla se
    // muestra (y se oye) al menos 1,2 s reales desde cada arranque del buzzer.
    const pin = world.pins.find((p) => p.pin === CONFIG.pines.rugido)?.value || 0;
    if (pin && !pinPrevio) rugidoVisualHasta = Math.max(rugidoVisualHasta, reloj + 1.2);
    pinPrevio = pin;
    E.est.texBanda.offset.y -= (vBanda * h / 1000) / 0.8;
  }
  quitarMallas();
  for (const b of rio.basura) b.malla.position.set(b.px, b.py, b.pz);

  // ---- Hardware virtual -> 3D ----
  const rm = rampaMundo();
  const rampaDeg = -rm.th / DEG;
  const apertura = Math.min(1, Math.max(0, (rampaDeg + 25) / 60));
  E.est.cabeza.rotation.z = rm.th;
  const fi = 8 + 67 * apertura; // inclinación del cráneo: boca 33° atrapando, 40° abierta en alivio
  E.est.craneoPiv.rotation.z = -(fi - rampaDeg) * DEG;
  E.est.grupo.position.y = E.agua.y - 0.12 + (quieto ? 0 : Math.sin(reloj * 0.8) * 0.02);
  E.est.grupo.rotation.x = quieto ? 0 : Math.sin(reloj * 0.6) * 0.008;
  E.barreras.position.y = E.agua.y + 0.05; // las boyas flotan
  const led = world.leds[0];
  if (led) {
    const [r, g, b] = led.rgb;
    for (const o of E.est.ojos) {
      o.malla.material.emissive.setRGB(r / 255, g / 255, b / 255);
      o.malla.material.emissiveIntensity = 3;
      o.luz.color.setRGB(r / 255, g / 255, b / 255);
      o.luz.intensity = ((r + g + b) / 765) * 40;
    }
  }
  const rugiendo = reloj < rugidoVisualHasta;
  E.est.ondas.forEach((m, i) => {
    const k = quieto ? 0.5 : (reloj * 1.6 + i / 3) % 1;
    m.scale.setScalar(0.4 + k * 3.2);
    m.material.opacity = rugiendo ? (1 - k) * 0.8 : 0;
  });
  if (rugiendo !== sonando) { rugidoAudio(rugiendo); sonando = rugiendo; }
  E.est.hazMat.color.set(hazTapado ? "#ffffff" : "#ff2020");
  E.est.hazMat.opacity = hazTapado ? 1 : 0.55;
  E.est.relleno.scale.y = Math.max(0.01, Math.min(1, rio.panzaKg / 25));
  E.est.relleno.position.y = -0.5 + E.est.relleno.scale.y / 2;
  llanta.visible = ajustes.atasco;
  if (ajustes.atasco) {
    const p = rm.aMundo(-RAMPA.largo + S_HAZ, 0.45);
    llanta.position.set(p.x, p.y, 0);
    llanta.rotation.set(Math.PI / 2, 0, rm.th);
  }

  const nivelM = ag.nivelCm(OJO_CAIMAN, estado.tS) / 100;
  E.agua.animar(quieto ? 0 : reloj, velocidadFlujo(nivelM), Math.min(1, ag.lluviaMmMin(estado.tS) / 2));
  E.lluviaFx.actualizar(dtReal / 1000, ag.lluviaMmMin(estado.tS));

  hudAcc += dtReal;
  if (hudAcc > 120) { hudAcc = 0; actualizarHud(rm); dibujarGrafica(); }

  controles.update();
  renderer.render(E.scene, E.camera);
  etiquetas.render(E.scene, E.camera);
}

function actualizarHud(rm) {
  const ag = demo.ag, { tS } = estado, cuenta = estado.rio.cuenta;
  $("reloj").textContent = mmss(tS);
  $("fase").textContent = tS < ag.duracionS ? "Lluvia" : "Bajada";
  const a = demo.ultima();
  const st = est?.status();
  // Banner: lo que sabe la estación, no solo lo que dice el cerebro.
  const sinDatos = ajustes.cortada || a.sinDatos || st?.modo === "SIN_DATOS" || st?.modo === "ALIVIO_SIN_DATOS";
  $("alertaTitulo").textContent = sinDatos ? "ESTACIÓN SIN DATOS" : `ALERTA ${ALERTA_TXT[a.nivel]}`;
  $("alerta").style.background = sinDatos ? COLOR.SIN_DATOS : COLOR[a.nivel];
  $("alerta").style.color = sinDatos ? "#fff" : "#111";
  $("motivo").textContent = sinDatos ? `el cerebro dice: alerta ${ALERTA_TXT[a.nivel].toLowerCase()}` : a.motivo + (a.ojo ? ` · ojo ${a.ojo}` : "");
  $("consejo").textContent = CONSEJO[a.nivel];
  const rangoAhora = NIVELES.indexOf(a.nivel);
  if (rangoAhora > estado.nivelAnunciado) $("anuncio").textContent = `Alerta ${ALERTA_TXT[a.nivel].toLowerCase()}: ${CONSEJO[a.nivel]}`;
  estado.nivelAnunciado = rangoAhora;

  if (world.dead) { $("modoTxt").textContent = "La placa no responde"; $("modoTec").textContent = "sin placa"; }
  else if (st) { $("modoTxt").textContent = NOMBRE_MODO[st.modo]; $("modoTec").textContent = st.modo.toLowerCase().replace(/_/g, " "); }

  const nivel = ag.nivelCm(OJO_CAIMAN, tS);
  $("tLluvia").textContent = `${num(ag.lluviaMmMin(tS))} mm/min`;
  $("tNivel").textContent = `${num(nivel, 0)} cm`;
  $("tFlujo").textContent = `${num(velocidadFlujo(nivel / 100))} m/s`;
  const servo = world.servos[0], motor = world.motores[0];
  $("tComp").textContent = servo ? `${num(servo.grados, 0)}° ${rm.sumergida ? "(en el agua)" : "(arriba)"}` : "–";
  if (st) {
    $("tBanda").textContent = `${Math.round((st.bandaPwm / 255) * 100)} %`;
    $("tObj").textContent = st.objetos;
    $("tKg").textContent = `${num(st.kg)} kg`;
  }
  $("tRpm").textContent = motor ? `${num(motor.rpm, 0)} rpm` : "–";
  $("tReal").textContent = cuenta.atrapadas;
  const error = cuenta.atrapadas ? Math.round(((st?.objetos ?? 0) - cuenta.atrapadas) / cuenta.atrapadas * 100) : 0;
  $("tError").textContent = cuenta.atrapadas ? `${error > 0 ? "+" : ""}${error} %` : "–";
  $("tKgReal").textContent = `${num(estado.rio.panzaKg)} kg`;
  $("tEsc").textContent = cuenta.escapadas + (cuenta.descartadas ? ` (+${cuenta.descartadas} fuera de vista)` : "");
  const aviso = estado.tPrimerAviso !== null && estado.tDesborde !== null ? `${num((estado.tDesborde - estado.tPrimerAviso) / 60, 0)} min`
    : estado.tPrimerAviso !== null ? "contando…" : "–";
  $("tAviso").textContent = aviso;
  const amps = world.corrienteActuadores();
  $("tAmp").textContent = `${num(amps, 2)} A`;
  $("ampBarra").style.width = `${Math.min(100, (amps / 3) * 100)}%`;
  $("ampBarra").style.background = amps > 0.45 && ajustes.alim === "arduino5v" ? "var(--rojo)" : servo?.bloqueado ? "var(--amarillo)" : "var(--accent)";
  const tipos = Object.keys(ASPECTO).map((n) => cuenta.porTipo[n] ? `${cuenta.porTipo[n]} ${cuenta.porTipo[n] === 1 ? n : PLURAL[n]}` : null).filter(Boolean);
  $("clasificacion").textContent = tipos.length ? tipos.join(" · ") : "todavía nada";
  (a.porOjo || []).forEach((o, i) => {
    const id = i + 1, cm = ag.nivelCm(id, tS);
    const txt = o.sinDatos ? "sin datos" : ALERTA_TXT[o.nivel].toLowerCase();
    $(`p${id}`).style.background = o.sinDatos ? "transparent" : COLOR[o.nivel];
    $(`m${id}`).textContent = `${txt} · ${o.motivo}`;
    $(`n${id}`).textContent = o.sinDatos ? "–" : `${num(cm, 0)} cm`;
    const et = E.ojos[i];
    et.luz.material.emissive.set(o.sinDatos ? "#000000" : COLOR[o.nivel]);
    et.etiqueta.element.textContent = o.sinDatos ? `Ojo ${id} · sin datos` : `Ojo ${id} · ${num(cm, 0)} cm · ${txt}`;
    et.etiqueta.element.style.setProperty("--c", o.sinDatos ? COLOR.SIN_DATOS : COLOR[o.nivel]);
  });
}

reiniciarTodo();
requestAnimationFrame(cuadro);

// Gancho para pruebas y demostraciones: avanzar sin esperar al navegador y sacar una foto.
// avanzar(ms) avanza ms de tiempo REAL (a la velocidad elegida: a ×20, 1000 ms = 20 s simulados).
window.__caiman = {
  get world() { return world; }, get est() { return est; }, get tS() { return estado.tS; }, E, ajustes, estado, demo,
  get escapadas() { return estado.rio.cuenta.escapadas; },
  /** Llamadas de dibujo y triángulos del último cuadro (renderer.info). */
  get info() { return { ...renderer.info.render }; },
  empezar() { $("empezar").click(); },
  avanzar(ms) { for (let t = 0; t < ms; t += 50) simularCuadro(ultimo + 50); },
  foto(ancho = 640) {
    renderer.render(E.scene, E.camera);
    const src = renderer.domElement, c = document.createElement("canvas");
    c.width = ancho; c.height = Math.round((ancho * src.height) / src.width);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  },
};
