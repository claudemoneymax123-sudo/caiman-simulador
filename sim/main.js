// Simulador: aguacero -> ojos -> cerebro -> estación (código real) -> hardware virtual -> 3D.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { construirEscena, RAMPA, CANAL } from "./escena.js";
import { VirtualWorld, createVirtualFive } from "./virtual-five.js";
import { crearEstacion, MODOS } from "../src/estacion.js";
import { crearCerebro } from "../src/cerebro.js";
import { crearAguacero, crearFuenteDemo, OJOS_DEMO } from "../src/aguacero.js";
import { CONFIG, UMBRALES } from "../src/config.js";

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const IR = CONFIG.pines.contadorIR;
const COLOR = { VERDE: "#2ecc71", AMARILLO: "#f5c400", NARANJA: "#ff7a1a", ROJO: "#ff3b3b" };
const COLOR_OJO = ["#9fd3ff", "#7fb8f0", "#5f9ce0", "#4a7fcc", "#ffffff"];

// ---- Render ------------------------------------------------------------------
const vista = $("vista");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
vista.prepend(renderer.domElement);
const etiquetas = new CSS2DRenderer({ element: $("etiquetas") });
const E = construirEscena(renderer);
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
const ajustes = { velocidad: 20, pausa: false, voltaje: 6.0, alim: "externa", masaKg: 0.35, cortada: false, atasco: false, sonido: false, componentes: false };
let ag, cerebro, fuente, tS, historiaAlerta, basura, escapadas, panzaKg, acumSpawn, ultimaConsulta;
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
  world = new VirtualWorld({ seed: (Math.random() * 1e9) | 0, voltajeServo: ajustes.voltaje, alimentacion: ajustes.alim, rampaMasaKg: ajustes.masaKg });
  world.setDigital(IR, 1);
  world.on("warning", (m) => log(`⚠ ${m}`, "aviso"));
  world.on("brownout", ({ amps }) => { log(`✖ CAÍDA DE TENSIÓN a ${amps.toFixed(2)} A: el Arduino se reinició, se perdió Firmata`, "error"); $("caida").classList.add("ver"); });
  five = createVirtualFive(world);
  board = new five.Board();
  board.on("error", () => {});
  log("Placa conectada, saludo Firmata…");
  board.on("ready", () => {
    // ↓↓↓ exactamente lo que hace hardware/run.js en la maqueta real ↓↓↓
    est = crearEstacion(five, board, CONFIG, { log: (m) => log(m), reloj: () => world.time });
    ultimaConsulta = -1e9;
  });
}

function reiniciarTodo() {
  ag = crearAguacero();
  cerebro = crearCerebro(UMBRALES);
  fuente = crearFuenteDemo({ aguacero: ag, cerebro, umbrales: UMBRALES });
  tS = 0; historiaAlerta = []; escapadas = 0; panzaKg = 0; acumSpawn = 0;
  for (const b of basura || []) E.scene.remove(b.malla);
  basura = [];
  $("consola").textContent = "";
  arrancarPlaca();
}

// ---- Basura flotante ------------------------------------------------------------
const TIPOS = [
  { nombre: "botella", p: 0.38, geo: new THREE.CylinderGeometry(0.06, 0.06, 0.42, 10).rotateZ(Math.PI / 2), mats: ["#a9dcef", "#7fc8a9", "#e9f3f7"], largo: 0.42, kg: 0.03 },
  { nombre: "bolsa", p: 0.25, geo: new THREE.SphereGeometry(0.22, 10, 6).scale(1.3, 0.3, 1), mats: ["#f4f4f4", "#1d1d1d", "#2f6fd1"], largo: 0.5, kg: 0.01 },
  { nombre: "icopor", p: 0.22, geo: new THREE.BoxGeometry(0.34, 0.1, 0.24), mats: ["#fbfbf6"], largo: 0.34, kg: 0.01 },
  { nombre: "lata", p: 0.1, geo: new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10).rotateX(Math.PI / 2), mats: ["#b8bcc2", "#c8252b"], largo: 0.2, kg: 0.015 },
  { nombre: "chancla", p: 0.05, geo: new THREE.BoxGeometry(0.3, 0.04, 0.11), mats: ["#3aa655", "#e2a000"], largo: 0.3, kg: 0.12 },
];
const matCache = new Map();
const mat = (c) => matCache.get(c) || matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 })).get(c);
const llanta = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.14, 10, 24), new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.8 }));
llanta.visible = false;
E.scene.add(llanta);

function soltarBasura(nivelM) {
  let r = Math.random(), t = TIPOS[0];
  for (const x of TIPOS) { if ((r -= x.p) <= 0) { t = x; break; } }
  const malla = new THREE.Mesh(t.geo, mat(t.mats[Math.floor(Math.random() * t.mats.length)]));
  malla.castShadow = true;
  const media = CANAL.mediaFondo + nivelM * (2.5 / 3.2) - 0.4;
  const b = { malla, tipo: t, estado: "rio", x: -46, z: (Math.random() * 2 - 1) * media, s: 0, fase: Math.random() * 6, contada: false };
  malla.rotation.y = Math.random() * 6;
  E.scene.add(malla);
  basura.push(b);
  if (basura.length > 320) { const v = basura.shift(); E.scene.remove(v.malla); }
}

// Geometría de la rampa en el mundo (a partir del ángulo físico del servo).
const V = new THREE.Vector3();
function rampaMundo() {
  const servo = world.servos[0];
  const rampaDeg = (servo ? servo.grados : CONFIG.compuerta.cerradaDeg) - world.rampaOffsetDeg;
  const th = -rampaDeg * DEG;
  const bx = RAMPA.bisagraX, by = E.est.grupo.position.y + 0.55;
  const puntaX = bx - RAMPA.largo * Math.cos(th) - 0.22 * Math.sin(th);
  const puntaY = by - RAMPA.largo * Math.sin(th) + 0.22 * Math.cos(th);
  return { rampaDeg, th, puntaX, puntaY, sumergida: puntaY < E.agua.y - 0.05 };
}

const S_HAZ = RAMPA.largo - 0.45;
function fisicaBasura(h, nivelM, velFlujo) {
  const rm = rampaMundo();
  const motor = world.motores[0];
  const vBanda = motor ? (motor.rpm / 60) * Math.PI * 0.04 * Math.sqrt(5) : 0; // Froude 1:5
  const andando = vBanda > 0.03 && !ajustes.atasco;
  const media = CANAL.mediaFondo + nivelM * (2.5 / 3.2) - 0.3;
  E.est.cabeza.updateWorldMatrix(true, false);
  let enBanda = 0, hazTapado = ajustes.atasco, ultimaEntrada = Infinity, enBoca = 0;
  for (const b of basura) if (b.estado === "banda") ultimaEntrada = Math.min(ultimaEntrada, b.s);

  for (let i = basura.length - 1; i >= 0; i--) {
    const b = basura[i];
    if (b.estado === "rio") {
      b.x += velFlujo * h * (0.85 + 0.15 * Math.sin(b.fase));
      b.z += Math.sin(b.fase + tS * 0.7) * 0.15 * h;
      const bz = E.barreraZ(b.x);
      if (bz !== null && Math.abs(b.z) > bz - 0.15) b.z = Math.sign(b.z) * (bz - 0.15); // la barrera la empuja al centro
      b.z = Math.max(-media, Math.min(media, b.z));
      if (rm.sumergida && b.x >= rm.puntaX - 0.25 && b.x < RAMPA.bisagraX && Math.abs(b.z) < 1.25) {
        if (andando && ultimaEntrada > 0.55) { b.estado = "banda"; b.s = 0; ultimaEntrada = 0; }
        else { b.estado = "boca"; }
      }
      if (!b.contada && b.x > RAMPA.bisagraX + 2) { b.contada = true; escapadas++; }
      if (b.x > 120) { E.scene.remove(b.malla); basura.splice(i, 1); continue; }
      b.malla.position.set(b.x, E.agua.y + 0.03 + Math.sin(tS * 2 + b.fase) * 0.03, b.z);
    } else if (b.estado === "boca") {
      if (!rm.sumergida) { b.estado = "rio"; continue; } // la boca se levantó: pasa por debajo
      if (andando && ultimaEntrada > 0.55) { b.estado = "banda"; b.s = 0; ultimaEntrada = 0; continue; }
      enBoca++;
      b.malla.position.set(rm.puntaX - 0.35 - (enBoca % 7) * 0.18, E.agua.y + 0.04, Math.max(-1.1, Math.min(1.1, b.z)));
    } else if (b.estado === "banda") {
      if (andando) b.s += vBanda * h;
      if (b.s >= RAMPA.largo - 0.05) { panzaKg += b.tipo.kg; E.scene.remove(b.malla); basura.splice(i, 1); continue; }
      enBanda++;
      if (Math.abs(b.s - S_HAZ) < b.tipo.largo / 2) hazTapado = true;
      V.set(-RAMPA.largo + b.s, 0.3, Math.max(-1.1, Math.min(1.1, b.z * 0.8)));
      b.malla.position.copy(V.applyMatrix4(E.est.cabeza.matrixWorld));
    }
  }
  world.cargaBanda = Math.min(0.5, enBanda * 0.02) + (ajustes.atasco ? 1 : 0);
  world.setDigital(IR, hazTapado ? 0 : 1); // receptor IR: BAJO = haz cortado
  return { rm, vBanda, hazTapado };
}

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
$("play").onclick = () => { ajustes.pausa = !ajustes.pausa; $("play").textContent = ajustes.pausa ? "▶ Seguir" : "⏸ Pausar"; };
$("velocidad").onchange = (e) => (ajustes.velocidad = +e.target.value);
$("reiniciar").onclick = () => reiniciarTodo();
$("sonido").onclick = () => { ajustes.sonido = !ajustes.sonido; $("sonido").textContent = ajustes.sonido ? "🔊 Sonido" : "🔇 Sonido"; $("sonido").classList.toggle("on", ajustes.sonido); if (ajustes.sonido) rugidoAudio(false); };
$("voltaje").onchange = (e) => { ajustes.voltaje = +e.target.value; world.voltajeServo = ajustes.voltaje; log(`Servo alimentado a ${ajustes.voltaje} V`); };
$("alim").onchange = (e) => {
  ajustes.alim = e.target.value; world.alimentacion = ajustes.alim;
  log(ajustes.alim === "arduino5v" ? "⚠ Servo y motor ahora toman del pin 5 V del Arduino (≈500 mA máx.)" : "Servo y motor con fuentes externas", ajustes.alim === "arduino5v" ? "aviso" : "");
};
$("masa").oninput = (e) => { ajustes.masaKg = e.target.value / 1000; world.rampaMasaKg = ajustes.masaKg; $("masaOut").textContent = `${e.target.value} g`; };
$("componentes").onclick = () => { ajustes.componentes = !ajustes.componentes; E.est.setComponentes(ajustes.componentes); $("componentes").classList.toggle("on", ajustes.componentes); };
$("atasco").onclick = () => {
  ajustes.atasco = !ajustes.atasco;
  $("atasco").classList.toggle("on", ajustes.atasco);
  $("atasco").textContent = ajustes.atasco ? "Retirar la llanta" : "Atascar banda (llanta)";
  log(ajustes.atasco ? "Falla: una llanta se trabó al final de la banda" : "Llanta retirada", ajustes.atasco ? "aviso" : "");
};
$("cortar").onclick = () => {
  ajustes.cortada = !ajustes.cortada;
  $("cortar").classList.toggle("on", ajustes.cortada);
  $("cortar").textContent = ajustes.cortada ? "Reconectar con el cerebro" : "Cortar conexión con el cerebro";
  log(ajustes.cortada ? "Falla: no llega GET /alerta (WiFi / servidor caído)" : "Conexión con el cerebro restablecida", ajustes.cortada ? "aviso" : "");
};
$("reset").onclick = () => { log("— reinicio de la placa —"); arrancarPlaca(); };
$("caidaArreglar").onclick = () => { ajustes.alim = "externa"; $("alim").value = "externa"; log("— fuentes externas, placa reiniciada —"); arrancarPlaca(); };

const lista = $("ojosLista");
UMBRALES.ojos.forEach((o) => {
  const d = document.createElement("div");
  d.innerHTML = `<span class="punto" id="p${o.id}"></span><span>${o.nombre}<br><em id="m${o.id}">–</em></span><b id="n${o.id}" style="font-family:var(--mono)">–</b>`;
  lista.append(d);
});

// ---- Gráfica de 60 min -------------------------------------------------------------------
const graf = $("grafica"), gg = graf.getContext("2d");
function dibujarGrafica() {
  const W = graf.width, H = graf.height, maxCm = 200, total = 3600, abajo = 22;
  const x = (t) => (t / total) * W, y = (cm) => H - abajo - (cm / maxCm) * (H - abajo - 10);
  gg.clearRect(0, 0, W, H);
  gg.font = "18px ui-monospace, Menlo, monospace";
  for (const h of historiaAlerta) { gg.fillStyle = COLOR[h.nivel]; gg.fillRect(x(h.t), H - 10, x(5) + 1, 10); }
  gg.fillStyle = "#5b7fa6";
  for (let t = 0; t < total; t += 30) { const mm = ag.lluviaMmMin(t); gg.fillRect(x(t), H - abajo - mm * 22, x(30) - 1, mm * 22); }
  gg.strokeStyle = "#ff3b3b"; gg.setLineDash([8, 6]); gg.lineWidth = 2;
  const cota = UMBRALES.ojos[4].cotaDesbordeCm;
  gg.beginPath(); gg.moveTo(0, y(cota)); gg.lineTo(W, y(cota)); gg.stroke(); gg.setLineDash([]);
  gg.fillStyle = "#ff8080"; gg.fillText(`cota ${cota} cm`, 6, y(cota) - 6);
  OJOS_DEMO.forEach((o, i) => {
    gg.strokeStyle = COLOR_OJO[i]; gg.lineWidth = i === 4 ? 3 : 1.6; gg.beginPath();
    for (let t = 0; t <= total; t += 20) { const v = ag.nivelCm(o.id, t); t ? gg.lineTo(x(t), y(v)) : gg.moveTo(x(t), y(v)); }
    gg.stroke();
  });
  gg.strokeStyle = "#fff"; gg.lineWidth = 2;
  gg.beginPath(); gg.moveTo(x(tS), 0); gg.lineTo(x(tS), H); gg.stroke();
  gg.fillStyle = "#8e959f";
  for (const m of [0, 15, 30, 45, 60]) gg.fillText(`${m}′`, Math.min(W - 30, x(m * 60) + 3), 18);
}

// ---- Bucle principal ------------------------------------------------------------------------
let ultimo = performance.now(), hudAcc = 0, reloj = 0, ultimoRugido = false;
const ojosEst = [];

function cuadro(ahora) {
  requestAnimationFrame(cuadro);
  simularCuadro(ahora);
}

function simularCuadro(ahora) {
  const dtReal = Math.min(50, ahora - ultimo);
  ultimo = ahora;
  reloj += dtReal / 1000;
  let restante = ajustes.pausa ? 0 : dtReal * ajustes.velocidad;
  let info = { rm: rampaMundo(), vBanda: 0, hazTapado: false };

  while (restante > 0) {
    const h = Math.min(50, restante);
    restante -= h;
    tS += h / 1000;
    const nivelM = ag.nivelCm(5, tS) / 100;
    E.agua.setNivel(nivelM);
    E.est.grupo.position.y = E.agua.y - 0.12;
    const velFlujo = 0.25 + 1.25 * Math.max(0, nivelM - 0.15);

    // El "servidor": los ojos envían, el cerebro decide; la estación consulta cada 5 s.
    if (tS - (ultimaConsulta ?? -1e9) >= 5) {
      ultimaConsulta = tS;
      const a = fuente.actualizar(tS);
      historiaAlerta.push({ t: tS, nivel: a.nivel });
      if (est && !ajustes.cortada) est.setAlerta(a.nivel, a.motivo);
    }
    // Basura que baja con el agua
    acumSpawn += (ag.basuraObjMin(tS) / 60) * (h / 1000);
    while (acumSpawn >= 1) { acumSpawn -= 1; soltarBasura(nivelM); }
    info = fisicaBasura(h / 1000, nivelM, velFlujo);
    world.step(h);
    E.est.texBanda.offset.y -= (info.vBanda * h / 1000) / 0.8;
  }

  // ---- Hardware virtual -> 3D ----
  const rm = rampaMundo();
  const apertura = Math.min(1, Math.max(0, (rm.rampaDeg + 25) / 60));
  E.est.cabeza.rotation.z = rm.th;
  const fi = 8 + 52 * apertura; // inclinación del cráneo en el mundo (boca: 33° cerrada, 25° abierta)
  E.est.craneoPiv.rotation.z = -(fi - rm.rampaDeg) * DEG;
  E.est.grupo.position.y = E.agua.y - 0.12 + Math.sin(reloj * 0.8) * 0.02;
  E.est.grupo.rotation.x = Math.sin(reloj * 0.6) * 0.008;
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
  const rugiendo = !!world.pins[0]?.value;
  E.est.ondas.forEach((m, i) => {
    const k = (reloj * 1.6 + i / 3) % 1;
    m.scale.setScalar(0.4 + k * 3.2);
    m.material.opacity = rugiendo ? (1 - k) * 0.8 : 0;
  });
  if (rugiendo !== ultimoRugido) { rugidoAudio(rugiendo); ultimoRugido = rugiendo; }
  E.est.hazMat.color.set(info.hazTapado ? "#ffffff" : "#ff2020");
  E.est.hazMat.opacity = info.hazTapado ? 1 : 0.55;
  E.est.relleno.scale.y = Math.max(0.01, Math.min(1, panzaKg / 25));
  E.est.relleno.position.y = -0.5 + E.est.relleno.scale.y / 2;
  llanta.visible = ajustes.atasco;
  if (ajustes.atasco) {
    E.est.cabeza.updateWorldMatrix(true, false);
    llanta.position.copy(V.set(-RAMPA.largo + S_HAZ, 0.45, 0).applyMatrix4(E.est.cabeza.matrixWorld));
    llanta.rotation.set(Math.PI / 2, 0, rm.th);
  }

  const nivelM = ag.nivelCm(5, tS) / 100;
  E.agua.animar(reloj, 0.25 + 1.25 * Math.max(0, nivelM - 0.15), Math.min(1, ag.lluviaMmMin(tS) / 2));
  E.lluviaFx.actualizar(dtReal / 1000, ag.lluviaMmMin(tS));

  // Ojos (postes): color por su propia alerta
  const porOjo = fuente.ultima().porOjo || [];
  E.ojos.forEach((o, i) => {
    const a = porOjo[i]?.nivel || "VERDE";
    o.luz.material.emissive.set(COLOR[a]);
    const cm = ag.nivelCm(i + 1, tS);
    o.etiqueta.element.textContent = `Ojo ${i + 1} · ${cm.toFixed(0)} cm`;
    o.etiqueta.element.style.setProperty("--c", COLOR[a]);
  });

  hudAcc += dtReal;
  if (hudAcc > 120) { hudAcc = 0; actualizarHud(rm); dibujarGrafica(); }

  controles.update();
  renderer.render(E.scene, E.camera);
  etiquetas.render(E.scene, E.camera);
}

const NOMBRE_MODO = {
  CAPTURA: "atrapando basura", ALIVIO: "boca abierta: deja pasar la creciente", ATASCO: "banda atascada",
  SIN_DATOS: "sin datos del cerebro", ALIVIO_SIN_DATOS: "sin datos: boca abierta por seguridad",
};
function actualizarHud(rm) {
  const mm = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  $("reloj").textContent = mm(tS);
  const a = fuente.ultima();
  $("alerta").firstChild.textContent = `ALERTA ${a.nivel}`;
  $("alerta").style.background = COLOR[a.nivel];
  $("motivo").textContent = a.motivo + (a.ojo ? ` · ojo ${a.ojo}` : "");
  if (world.dead) $("modo").textContent = "Estación: SIN PLACA";
  else if (est) { const st = est.status(); $("modo").textContent = `Estación: ${st.modo} · ${NOMBRE_MODO[st.modo]}`; }
  const nivel = ag.nivelCm(5, tS);
  $("tLluvia").textContent = `${ag.lluviaMmMin(tS).toFixed(1)} mm/min`;
  $("tNivel").textContent = `${nivel.toFixed(0)} cm`;
  $("tFlujo").textContent = `${(0.25 + 1.25 * Math.max(0, nivel / 100 - 0.15)).toFixed(1)} m/s`;
  const servo = world.servos[0], motor = world.motores[0];
  $("tComp").textContent = servo ? `${servo.grados.toFixed(0)}° ${rm.sumergida ? "(abajo)" : "(arriba)"}` : "–";
  if (est) {
    const st = est.status();
    $("tBanda").textContent = `${st.bandaPwm}/255`;
    $("tObj").textContent = st.objetos;
    $("tKg").textContent = `${st.kg.toFixed(1)} kg`;
  }
  $("tRpm").textContent = motor ? `${motor.rpm.toFixed(0)} rpm` : "–";
  $("tEsc").textContent = escapadas;
  const amps = world.corrienteActuadores();
  $("tAmp").textContent = `${amps.toFixed(2)} A`;
  $("ampBarra").style.width = `${Math.min(100, (amps / 3) * 100)}%`;
  $("ampBarra").style.background = amps > 0.45 && ajustes.alim === "arduino5v" ? "var(--rojo)" : servo?.bloqueado ? "var(--amarillo)" : "var(--accent)";
  (a.porOjo || []).forEach((o, i) => {
    const id = i + 1;
    $(`p${id}`).style.background = COLOR[o.nivel];
    $(`m${id}`).textContent = `${o.nivel} · ${o.motivo}`;
    $(`n${id}`).textContent = `${ag.nivelCm(id, tS).toFixed(0)} cm`;
  });
}

reiniciarTodo();
requestAnimationFrame(cuadro);

// Gancho de depuración/pruebas: avanzar sin esperar al navegador y sacar una foto.
window.__caiman = {
  get world() { return world; }, get est() { return est; }, get tS() { return tS; }, E, ajustes,
  get escapadas() { return escapadas; },
  avanzar(ms) { for (let t = 0; t < ms; t += 50) simularCuadro(ultimo + 50); },
  foto(ancho = 640) {
    renderer.render(E.scene, E.camera);
    const src = renderer.domElement, c = document.createElement("canvas");
    c.width = ancho; c.height = Math.round((ancho * src.height) / src.width);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  },
};
