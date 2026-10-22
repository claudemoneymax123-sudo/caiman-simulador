// Johnny-Five virtual: la misma API que usa el controlador en la maqueta real,
// respaldada por modelos físicos de un Arduino Uno, un servo MG996R que mueve
// la rampa (boca), un motorreductor DC de 12 V para la banda, una tira LED RGB
// (ojos), un buzzer activo (rugido) y una barrera infrarroja (contador).
//
// El tiempo es simulado (world.step(ms)): corre determinista en las pruebas
// y a cualquier velocidad en la vista 3D.

class Emitter {
  #h = new Map();
  on(ev, fn) { (this.#h.get(ev) || this.#h.set(ev, []).get(ev)).push(fn); return this; }
  off(ev, fn) { const l = this.#h.get(ev); if (l) this.#h.set(ev, l.filter((f) => f !== fn)); return this; }
  emit(ev, ...a) { for (const fn of this.#h.get(ev) || []) fn.apply(this, a); return this; }
}

// ---- Arduino Uno ------------------------------------------------------------
const UNO = {
  digital: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
  pwm: new Set([3, 5, 6, 9, 10, 11]),
  serial: new Set([0, 1]),
  servoTimerPins: new Set([9, 10]), // la librería Servo usa el Timer1 -> sin PWM en 9/10
};

// ---- Datos de fábrica -------------------------------------------------------
const MG996R = { // grados/s sin carga, N·m de bloqueo, A de bloqueo
  4.8: { vel: 60 / 0.19, par: 9.4 * 0.0980665, aBloqueo: 2.5 },
  6.0: { vel: 60 / 0.15, par: 11.0 * 0.0980665, aBloqueo: 2.5 },
};
const SERVO_TRAMA_MS = 20, SERVO_ZONA_MUERTA = 0.6, SERVO_BANDA_P = 9, FRICCION = 0.12;
// Motorreductor 12 V tipo JGA25-370 (100 rpm): vacío 0,08 A, bloqueo 1,6 A.
const MOTOR = { rpm: 100, aVacio: 0.08, aBloqueo: 1.6, tauS: 0.15 };
const G = 9.81;

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class VirtualWorld extends Emitter {
  constructor(opts = {}) {
    super();
    this.time = 0; // ms
    this.rng = opts.rng || mulberry32(opts.seed ?? 1);
    this.timers = [];
    this.servos = []; this.motores = []; this.leds = []; this.pins = []; this.botones = [];
    this.board = null;
    this.dead = false;

    // Montaje físico (editable desde el simulador)
    this.voltajeServo = opts.voltajeServo ?? 6.0;          // 4.8 o 6.0
    this.alimentacion = opts.alimentacion ?? "externa";    // "externa" | "arduino5v"
    this.rampaMasaKg = opts.rampaMasaKg ?? 0.35;           // rampa + banda + rodillos (maqueta, 1 m de largo)
    this.rampaBrazoM = opts.rampaBrazoM ?? 0.45;           // bisagra -> centro de masa (casi la mitad de la rampa)
    // Contrapeso detrás de la bisagra (kg·m). Por diseño compensa un 15 % MÁS que la
    // rampa: sin corriente la rampa SUBE sola (falla segura = boca abierta) y el servo
    // trabaja para cerrarla. 0 = sin contrapeso (la rampa cae cerrada sin corriente).
    this.contrapesoKgM = opts.contrapesoKgM ?? 0.35 * 0.45 * 1.15;
    this.rampaOffsetDeg = opts.rampaOffsetDeg ?? 45;       // servo 45° = rampa horizontal
    this.cargaBanda = 0;                                   // 0..1, la pone la escena (basura / atasco)
    this.digital = new Map();                              // nivel de cada pin de entrada
  }

  servoSpec() { return MG996R[this.voltajeServo] || MG996R[6.0]; }

  addTimer(periodMs, fn, once = false) {
    const t = { next: this.time + periodMs, period: periodMs, fn, once, alive: true };
    this.timers.push(t);
    return t;
  }

  warn(msg) { this.emit("warning", msg); }

  /** Nivel eléctrico de un pin de entrada (lo maneja la escena o la prueba). */
  setDigital(pin, value) {
    if (this.digital.get(pin) === value) return;
    this.digital.set(pin, value);
    for (const b of this.botones) if (b.pin === pin) b._entrada(value);
  }

  step(dtMs) {
    // Acumula la fracción de milisegundo para no adelantarse al reloj de la escena.
    this._resto = (this._resto || 0) + dtMs;
    const n = Math.floor(this._resto);
    this._resto -= n;
    for (let i = 0; i < n; i++) {
      this.time += 1;
      {
        // El ciclo del controlador corre en el portátil: sigue andando aunque el Arduino se caiga.
        for (const t of this.timers) {
          if (t.alive && this.time >= t.next) {
            t.fn();
            if (t.once) t.alive = false; else t.next += t.period;
          }
        }
        this.timers = this.timers.filter((t) => t.alive);
      }
      for (const s of this.servos) s._fisica(1);
      for (const m of this.motores) m._fisica(1);
      this._revisarAlimentacion();
    }
  }

  corrienteActuadores() {
    return this.servos.reduce((a, s) => a + s.corrienteA, 0) + this.motores.reduce((a, m) => a + m.corrienteA, 0);
  }

  _revisarAlimentacion() {
    if (this.dead || this.alimentacion !== "arduino5v") return;
    // Puerto USB + regulador del Uno: ~500 mA; se cae antes.
    const a = this.corrienteActuadores();
    this._sobre = a > 0.45 ? (this._sobre || 0) + 1 : 0;
    if (this._sobre > 4) {
      this.dead = true;
      // El Uno se reinicia: sus salidas quedan en 0 y deja de obedecer. El programa
      // en el portátil NO se entera por sí solo (sigue mandando órdenes que nadie ejecuta).
      for (const s of this.servos) s.flojo = true;
      for (const m of this.motores) m.pwm = 0;
      for (const l of this.leds) l.rgb = [0, 0, 0];
      for (const p of this.pins) p.value = 0;
      this.emit("brownout", { amps: a });
      this.board?.emit("close");
    }
  }
}

export function createVirtualFive(world) {
  function reservar(pin, que) {
    if (!UNO.digital.has(pin)) throw new Error(`Pin Error: ${pin} is not a valid digital pin (${que})`);
    if (UNO.serial.has(pin)) world.warn(`D${pin} es el puerto serie USB: ${que} ahí rompe Firmata.`);
  }
  function exigirPwm(pin, que) {
    if (!UNO.pwm.has(pin)) throw new Error(`Pin Error: ${pin} is not a valid PWM pin (${que})`);
    if (UNO.servoTimerPins.has(pin) && world.servos.length)
      world.warn(`${que} en D${pin}: la librería Servo desactiva el PWM de los pines 9 y 10.`);
  }

  class Board extends Emitter {
    constructor(opts = {}) {
      super();
      this.id = opts.id || "UNO-VIRTUAL";
      this.isReady = false;
      world.board = this;
      world.addTimer(opts.readyDelayMs ?? 50, () => { this.isReady = true; this.emit("ready"); }, true);
    }
    // Igual que johnny-five@2.1.0: solo la parte de nanosegundos -> vuelve a 0 cada segundo.
    millis() { return world.time % 1000; }
    loop(ms, fn) { const t = world.addTimer(ms, () => fn(() => (t.alive = false))); return this; }
    wait(ms, fn) { world.addTimer(ms, fn, true); return this; }
  }

  class Servo extends Emitter {
    constructor(opts) {
      super();
      opts = typeof opts === "number" ? { pin: opts } : opts;
      reservar(opts.pin, "Servo");
      this.pin = opts.pin;
      this.range = opts.range || [0, 180];
      this.value = opts.startAt ?? 90;
      this._latch = this.value;
      this.grados = this.value;   // ángulo físico del eje
      this.vel = 0;               // °/s
      this.corrienteA = 0.01;
      this.bloqueado = false;
      this.flojo = false;
      this._trama = 0;
      world.servos.push(this);
    }
    to(deg) {
      if (world.dead) return this;
      if (typeof deg !== "number" || Number.isNaN(deg)) {
        // Como johnny-five 2.1.0: NaN termina en 0 µs y Firmata lo toma como 0°.
        world.warn(`Servo D${this.pin}: ángulo inválido (${deg}); el servo real iría a 0°`);
        this.value = 0;
        return this;
      }
      this.value = Math.min(this.range[1], Math.max(this.range[0], deg));
      return this;
    }
    _fisica(dtMs) {
      this._trama += dtMs;
      if (this._trama >= SERVO_TRAMA_MS) { this._trama -= SERVO_TRAMA_MS; this._latch = this.value; }
      const rampa = ((this.grados - world.rampaOffsetDeg) * Math.PI) / 180;
      // Par de la gravedad sobre la rampa (+ = la empuja hacia abajo / cerrar).
      // Par neto de rampa y contrapeso (+ = hacia abajo / cerrar, − = hacia arriba / abrir).
      const parG = (world.rampaMasaKg * world.rampaBrazoM - world.contrapesoKgM) * G * Math.cos(rampa);
      if (this.flojo) { // sin señal: gana el lado más pesado y la rampa va hasta su tope
        const vel = 0.04 * Math.min(2, Math.abs(parG) / 0.2) * dtMs; // grados por paso
        if (parG > 0) this.grados = Math.max(this.range[0] - 2, this.grados - vel);
        else this.grados = Math.min(this.range[1] + 2, this.grados + vel);
        this.corrienteA = 0;
        return;
      }
      const sp = world.servoSpec();
      const err = this._latch - this.grados;
      let v = 0;
      if (Math.abs(err) > SERVO_ZONA_MUERTA) {
        const dir = Math.sign(err);
        const opone = Math.max(0, dir * parG); // abrir = levantar la rampa contra la gravedad
        const disp = 1 - (opone + FRICCION * sp.par) / sp.par;
        this.bloqueado = disp <= 0;
        v = dir * Math.max(0, disp / (1 - FRICCION)) * sp.vel * Math.min(1, Math.abs(err) / SERVO_BANDA_P);
        if (opone > sp.par) v = -dir * 30 * (opone / sp.par - 1); // el peso vence al servo
      } else this.bloqueado = false;
      this.vel += (v - this.vel) * Math.min(1, dtMs / 14);
      this.grados += (this.vel * dtMs) / 1000;
      const lo = this.range[0] - 2, hi = this.range[1] + 2; // topes mecánicos
      if (this.grados < lo) { this.grados = lo; this.vel = 0; }
      if (this.grados > hi) { this.grados = hi; this.vel = 0; }
      const moviendo = Math.abs(this.vel) > 5;
      const frac = Math.min(1, (Math.abs(parG) + (moviendo ? FRICCION * sp.par : 0)) / sp.par);
      this.corrienteA = this.bloqueado ? sp.aBloqueo : Math.min(sp.aBloqueo, 0.01 + sp.aBloqueo * frac + (moviendo ? 0.0012 * Math.abs(this.vel) : 0));
    }
  }

  class Motor extends Emitter {
    constructor(opts) {
      super();
      opts = typeof opts === "number" ? { pin: opts } : opts;
      if (opts.pins) throw new Error("Motor virtual: solo se modela el motor no direccional ({ pin })");
      reservar(opts.pin, "Motor");
      exigirPwm(opts.pin, "Motor");
      this.pin = opts.pin;
      this.pwm = 0;
      this.umbral = opts.threshold ?? 30;
      this.rpm = 0;
      this.corrienteA = 0;
      world.motores.push(this);
    }
    // johnny-five pone en 0 toda velocidad menor que su umbral (threshold = 30).
    start(speed = 128) {
      if (world.dead) return this;
      const v = Math.min(255, Math.max(0, Math.round(speed)));
      this.pwm = v < this.umbral ? 0 : v;
      return this;
    }
    stop() { this.pwm = 0; return this; }
    _fisica(dtMs) {
      const d = this.pwm / 255;
      const carga = Math.min(1, Math.max(0, world.cargaBanda));
      const objetivo = d * MOTOR.rpm * (1 - carga);
      this.rpm += (objetivo - this.rpm) * Math.min(1, dtMs / 1000 / MOTOR.tauS);
      // Corriente ~ par: vacío + carga; al arrancar, pico hasta que gira.
      const deslizamiento = d > 0 ? 1 - this.rpm / (d * MOTOR.rpm) : 0;
      this.corrienteA = d * (MOTOR.aVacio + (MOTOR.aBloqueo - MOTOR.aVacio) * Math.max(carga, Math.min(1, deslizamiento)));
    }
  }

  class Led extends Emitter {
    constructor(opts) {
      super();
      const pin = typeof opts === "object" ? opts.pin : opts;
      reservar(pin, "Led");
      this.pin = pin;
      this.value = 0;
      world.leds.push(this);
    }
    brightness(v) { exigirPwm(this.pin, "Led"); if (!world.dead) this.value = Math.round(v); return this; }
  }

  // Led.RGB: tres canales PWM (cátodo común / MOSFET por canal).
  Led.RGB = class RGB extends Emitter {
    constructor(opts) {
      super();
      const p = Array.isArray(opts) ? opts : Array.isArray(opts.pins) ? opts.pins : [opts.pins.red, opts.pins.green, opts.pins.blue];
      p.forEach((pin) => { reservar(pin, "Led.RGB"); exigirPwm(pin, "Led.RGB"); });
      this.pins = p;
      this.isAnode = !!opts.isAnode;
      this.rgb = [0, 0, 0];
      world.leds.push(this);
    }
    color(r, g, b) {
      let c;
      if (Array.isArray(r)) c = r;
      else if (typeof r === "object") c = [r.red, r.green, r.blue];
      else if (typeof r === "string" && /^#?[0-9a-f]{6}$/i.test(r)) { const h = r.replace("#", ""); c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
      else c = [r, g, b];
      if (c.some((v) => v == null || Number.isNaN(+v))) throw new Error(`Led.RGB.color: invalid color ([${c.join(",")}])`);
      if (!world.dead) this.rgb = c.map((v) => Math.min(255, Math.max(0, Math.round(v))));
      return this;
    }
    off() { if (!world.dead) this.rgb = [0, 0, 0]; return this; }
    on() { return this.color([255, 255, 255]); }
  };

  class Pin extends Emitter {
    constructor(opts) {
      super();
      const pin = typeof opts === "object" ? opts.pin : opts;
      reservar(pin, "Pin");
      this.pin = pin;
      this.value = 0;
      world.pins.push(this);
    }
    high() { if (!world.dead) { this.value = 1; this.emit("high"); } return this; }
    low() { if (!world.dead) { this.value = 0; this.emit("low"); } return this; }
  }

  // Button: como Johnny-Five, con pull-up el nivel BAJO es "presionado",
  // y un antirrebote interno de 7 ms antes de emitir press/release.
  class Button extends Emitter {
    constructor(opts) {
      super();
      opts = typeof opts === "number" ? { pin: opts } : opts;
      reservar(opts.pin, "Button");
      this.pin = opts.pin;
      this.pullup = !!(opts.isPullup || opts.pullup);
      this.isDown = false;
      if (!world.digital.has(this.pin)) world.digital.set(this.pin, this.pullup ? 1 : 0);
      world.botones.push(this);
      // Como johnny-five: el primer reporte de Firmata ya dispara "press" si el pin
      // arranca en el nivel de "presionado" (p. ej. el haz IR tapado al encender).
      world.addTimer(7, () => {
        const v = world.digital.get(this.pin);
        if ((this.pullup ? v === 0 : v === 1) && !this.isDown) { this.isDown = true; this.emit("down"); this.emit("press"); }
      }, true);
    }
    _entrada(v) {
      if (world.dead) return; // el Uno reiniciado ya no reporta
      const abajo = this.pullup ? v === 0 : v === 1;
      world.addTimer(7, () => {
        const ahora = world.digital.get(this.pin);
        const sigue = this.pullup ? ahora === 0 : ahora === 1;
        if (sigue === abajo && abajo !== this.isDown) {
          this.isDown = abajo;
          if (abajo) { this.emit("down"); this.emit("press"); }
          else { this.emit("up"); this.emit("release"); }
        }
      }, true);
    }
  }

  return { Board, Servo, Motor, Led, Pin, Button };
}
