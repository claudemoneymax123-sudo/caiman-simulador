// Conexión con el Arduino por USB.
//
// johnny-five@2.1.0 trae `firmata` y `serialport@8` como dependencias OPCIONALES.
// serialport@8 compila código nativo al instalarse y falla en Node recientes;
// npm lo salta sin avisar y la placa nunca conecta. Por eso abrimos el puerto
// con serialport@13 (binarios precompilados, no compila nada) + firmata-io,
// y se lo entregamos a Johnny-Five ya armado con { io }.

import five from "johnny-five";
import { SerialPort } from "serialport";
import firmataIo from "firmata-io";

const Firmata = firmataIo.Firmata;
// Arduino, Arduino.org, CH340 (clones), FTDI, CP210x
const FABRICANTES = new Set(["2341", "2a03", "1a86", "0403", "10c4"]);
const NOMBRE_USB = /usbmodem|usbserial|wchusbserial|ttyACM|ttyUSB|^COM\d+/i;

export async function buscarArduino() {
  const puertos = await SerialPort.list();
  const p = puertos.find((x) => FABRICANTES.has(String(x.vendorId || "").toLowerCase()))
    || puertos.find((x) => NOMBRE_USB.test(x.path));
  return p?.path;
}

function fallar(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

/** Devuelve un five.Board conectado (emite "ready" cuando el Arduino responde). */
export async function conectarPlaca({ repl = false, esperaMs = 10000 } = {}) {
  const path = process.env.CAIMAN_PORT || (await buscarArduino());
  if (!path) fallar("No se encontró ningún Arduino por USB. Conéctelo, o indique el puerto: CAIMAN_PORT=/dev/tty.usbmodemXXXX");

  // El puerto se crea y se entrega a Firmata en el mismo instante: Firmata
  // escucha el evento "open" para avisar "connect" a Johnny-Five.
  const puerto = new SerialPort({ path, baudRate: 57600 });
  const io = new Firmata(puerto);
  // El tiempo de espera propio de Johnny-Five va más largo para que salga el aviso en español.
  const board = new five.Board({ io, repl, timeout: esperaMs + 10000 });

  const espera = setTimeout(() => fallar(
    `El Arduino en ${path} no respondió en ${esperaMs / 1000} s. ¿Tiene cargado StandardFirmata (Archivo → Ejemplos → Firmata)?`,
  ), esperaMs);
  board.once("ready", () => clearTimeout(espera));
  io.on("error", (e) => fallar(`Puerto ${path}: ${e.message}${/busy|lock|access/i.test(e.message) ? " (¿lo tiene abierto el Monitor Serie del IDE de Arduino?)" : ""}`));
  console.log(`Conectando con el Arduino en ${path}…`);
  return board;
}
