// Arduino Uno con StandardFirmata, emulado byte a byte (solo para pruebas en Node).
// Reemplaza al puerto serie: firmata-io le escribe los mismos bytes que mandaría
// por USB y recibe las mismas respuestas que daría la placa real.

import { EventEmitter } from "node:events";

const MODO = { INPUT: 0, OUTPUT: 1, ANALOG: 2, PWM: 3, SERVO: 4, I2C: 6, PULLUP: 0x0b };
const PWM = new Set([3, 5, 6, 9, 10, 11]);

export class UnoFirmata extends EventEmitter {
  constructor() {
    super();
    this.modo = {};        // pin -> modo
    this.analog = {};      // pin -> último valor PWM / servo (ANALOG_MESSAGE)
    this.digital = {};     // pin -> 0/1 escrito por la placa (salidas)
    this.entradas = { 2: 1 }; // nivel en los pines de entrada (D2 con pull-up = 1)
    this.reporta = new Set(); // puertos con REPORT_DIGITAL activo
    this.servoCfg = {};
    this.historial = [];   // [t, tipo, pin, valor]
    this.buf = [];
    this.isOpen = false;
    // Al abrir el puerto el Uno se reinicia y StandardFirmata anuncia versión y firmware.
    setTimeout(() => { this.isOpen = true; this.emit("open"); this._enviar([0xf9, 2, 5]); this._sysex([0x79]); }, 5);
  }

  write(data, cb) {
    for (const b of data) this._byte(b);
    cb?.();
    return true;
  }

  _enviar(bytes) { setImmediate(() => this.emit("data", Buffer.from(bytes))); }

  _byte(b) {
    const buf = this.buf;
    if (b & 0x80 && b !== 0xf7 && buf[0] !== 0xf0) buf.length = 0; // nuevo comando
    buf.push(b);
    const c = buf[0];
    if (c === 0xf0) { if (b === 0xf7) { this._sysex(buf.slice(1, -1)); buf.length = 0; } return; }
    const largo = c === 0xf9 || c === 0xff ? 1 : (c & 0xf0) === 0xc0 || (c & 0xf0) === 0xd0 ? 2 : 3;
    if (buf.length < largo) return;
    const [, d1, d2] = buf;
    buf.length = 0;
    const t = Date.now();
    if (c === 0xf9) this._enviar([0xf9, 2, 5]);
    else if (c === 0xf4) { this.modo[d1] = d2; this.historial.push([t, "modo", d1, d2]); }
    else if (c === 0xf5) { this.digital[d1] = d2; this.historial.push([t, "digital", d1, d2]); }
    else if ((c & 0xf0) === 0xe0) { const pin = c & 0x0f, v = d1 | (d2 << 7); this.analog[pin] = v; this.historial.push([t, "analog", pin, v]); }
    else if ((c & 0xf0) === 0x90) {
      const puerto = c & 0x0f, v = d1 | (d2 << 7);
      for (let i = 0; i < 8; i++) {
        const pin = puerto * 8 + i;
        // Como StandardFirmata: escribe en OUTPUT y en INPUT (en INPUT, un 1 activa el pull-up interno).
        if (this.modo[pin] === MODO.OUTPUT || this.modo[pin] === MODO.INPUT) {
          const nv = (v >> i) & 1;
          if (this.digital[pin] !== nv) { this.digital[pin] = nv; this.historial.push([t, "digital", pin, nv]); }
        }
      }
    } else if ((c & 0xf0) === 0xd0) { if (d1) { this.reporta.add(c & 0x0f); this._reportarPuerto(c & 0x0f); } else this.reporta.delete(c & 0x0f); }
  }

  _sysex([cmd, ...d]) {
    if (cmd === 0x79) { // QUERY_FIRMWARE
      const nombre = [..."StandardFirmata.ino"].flatMap((ch) => [ch.charCodeAt(0) & 0x7f, 0]);
      this._enviar([0xf0, 0x79, 2, 5, ...nombre, 0xf7]);
    } else if (cmd === 0x6b) { // CAPABILITY_QUERY
      const r = [0xf0, 0x6c];
      for (let pin = 0; pin < 20; pin++) {
        if (pin > 1) {
          r.push(MODO.INPUT, 1, MODO.OUTPUT, 1, MODO.PULLUP, 1);
          if (PWM.has(pin)) r.push(MODO.PWM, 8);
          r.push(MODO.SERVO, 14);
          if (pin >= 14) r.push(MODO.ANALOG, 10);
          if (pin === 18 || pin === 19) r.push(MODO.I2C, 1);
        }
        r.push(0x7f);
      }
      this._enviar([...r, 0xf7]);
    } else if (cmd === 0x69) { // ANALOG_MAPPING_QUERY
      const r = [0xf0, 0x6a];
      for (let pin = 0; pin < 20; pin++) r.push(pin >= 14 ? pin - 14 : 0x7f);
      this._enviar([...r, 0xf7]);
    } else if (cmd === 0x70) { // SERVO_CONFIG
      const [pin, a, b, c2, e] = d;
      this.servoCfg[pin] = [a | (b << 7), c2 | (e << 7)];
    }
  }

  _reportarPuerto(puerto) {
    let v = 0;
    for (let i = 0; i < 8; i++) v |= ((this.entradas[puerto * 8 + i] ?? 0) & 1) << i;
    this._enviar([0x90 | puerto, v & 0x7f, (v >> 7) & 0x01]);
  }

  pullUp(pin) { return (this.modo[pin] === MODO.INPUT && this.digital[pin] === 1) || this.modo[pin] === MODO.PULLUP; }

  /** Cambia el nivel eléctrico de un pin de entrada (p. ej. la barrera IR en D2). */
  ponerEntrada(pin, nivel) {
    this.entradas[pin] = nivel;
    const puerto = pin >> 3;
    if (this.reporta.has(puerto)) this._reportarPuerto(puerto);
  }

  close(cb) { this.isOpen = false; cb?.(); }
}
