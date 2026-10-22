// Proyecto CAIMÁN · Caimán 1 a escala 1:5 — configuración.
// La comparten la maqueta real (hardware/) y el simulador 3D (simulador.html).
// Todo número de aquí se mide o calibra en el banco o en campo.

export const CONFIG = Object.freeze({
  // Mapa de pines del Arduino Uno.
  // OJO: la librería Servo desactiva el PWM de los pines 9 y 10,
  // por eso el servo va en el 9 y los ojos y la banda usan 3, 5, 6 y 11.
  pines: Object.freeze({
    compuerta: 9,    // servo MG996R de la boca / rampa (señal naranja)
    banda: 3,        // MOSFET IRLZ44N -> motor DC de la banda (PWM)
    ojoRojo: 5,      // tira LED RGB de los ojos (vía MOSFET por canal)
    ojoVerde: 6,
    ojoAzul: 11,
    rugido: 8,       // buzzer activo 12 V vía transistor (o relé a sirena)
    contadorIR: 2,   // receptor de barrera infrarroja (LOW = haz cortado)
  }),

  bucleMs: 50, // ciclo de control: 20 Hz

  // Boca = rampa de entrada. CERRADA = rampa abajo, atrapando basura.
  // ABIERTA = rampa arriba (compuerta de alivio): deja pasar el agua en creciente.
  compuerta: Object.freeze({
    cerradaDeg: 20,       // calibrar: rampa tocando el agua
    abiertaDeg: 80,       // calibrar: rampa ~35° sobre la horizontal, fuera del agua
    velCierreDegS: 30,    // cerrar despacio, nunca de golpe
    // Al arrancar se manda ABIERTA (abrir de golpe es seguro) y luego cierra despacio:
    // así un reinicio nunca deja caer la rampa a toda velocidad desde arriba.
  }),

  banda: Object.freeze({
    normal: 150,          // PWM 0–255 en VERDE
    alta: 255,            // AMARILLO / NARANJA: llega más basura
    arranqueMs: 600,      // rampa de arranque suave (evita pico de corriente)
  }),

  contador: Object.freeze({
    antirreboteMs: 120,   // dos cortes del haz más juntos = el mismo objeto
    masaPromedioG: 35,    // ESTIMADO: pesar una muestra real y ajustar
    atascoMs: 3000,       // haz cortado más de esto = algo atascado en la banda
    reintentosAtasco: 3,
    pausaAtascoMs: 4000,
    rugidoPorKilo: true,  // rugido corto por cada kilo (en campo puede apagarse para no confundirlo con la alarma)
  }),

  // Aviso del servidor ("cerebro"): GET /alerta.
  conexion: Object.freeze({
    sinDatosMs: 30000,        // sin alerta nueva -> SIN DATOS (ojos azules)
    abrirSinDatosMs: 120000,  // sin datos tanto tiempo -> abrir la boca (falla segura)
  }),

  colores: Object.freeze({
    VERDE: [0, 255, 40],
    AMARILLO: [255, 190, 0],
    NARANJA: [255, 80, 0],
    ROJO: [255, 0, 0],
    SIN_DATOS: [0, 80, 255],
    ATASCO: [200, 0, 255],
  }),
});

// Umbrales del cerebro. PROVISIONALES: el documento del proyecto pide no
// inventar valores definitivos. Se calibran con los datos de la Fase 1.
export const UMBRALES = Object.freeze({
  provisional: true,
  lluvia10minMm: 8,          // AMARILLO: lluvia fuerte aguas arriba
  subidaCmMin: 4,            // NARANJA: el nivel sube rápido
  ventanaSubidaMin: 2,
  bajarTrasMin: 5,           // la alerta baja UN escalón por cada 5 min sin cumplir la condición
  ojoSinDatosS: 180,         // un ojo sin lecturas en 3 min se marca "sin datos" (no cuenta como VERDE)
  // Cota de desborde (ROJO) de cada ojo, en cm sobre el fondo del cauce.
  ojos: Object.freeze([
    { id: 1, nombre: "Ojo 1 · Rebolo alto", cotaDesbordeCm: 110 },
    { id: 2, nombre: "Ojo 2", cotaDesbordeCm: 120 },
    { id: 3, nombre: "Ojo 3", cotaDesbordeCm: 130 },
    { id: 4, nombre: "Ojo 4", cotaDesbordeCm: 140 },
    { id: 5, nombre: "Ojo 5 · junto al caimán", cotaDesbordeCm: 150 },
  ]),
  // Firmware del ojo (según la especificación de la Fase 1): lectura cada 60 s;
  // cada 15 s si sube > 15 cm en 2 min.
  envioNormalS: 60,
  envioRapidoS: 15,
  rapidoSiSubeCm: 15,
});
