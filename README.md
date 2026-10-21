# Proyecto CAIMÁN · Caimán 1 a escala 1:5

**Simulador en línea:** <https://claudemoneymax123-sudo.github.io/caiman-simulador/>

Maqueta y simulador de **las fauces** del Caimán 1, la estación piloto en la salida del arroyo Rebolo (Carrera 21) al Caño de la Auyama. Atrapa la basura antes de que llegue al río Magdalena.

La maqueta hace lo que pide la especificación de la Fase 1 para el caimán a escala:

- Una rampa con banda que saca la basura del agua.
- Ojos LED del color de la alerta.
- Un rugido cuando la alerta pasa a ROJO y cada vez que se completa un kilo de basura.
- En ROJO, la boca se abre (compuerta de alivio) y la banda se detiene.
- Un contador de objetos con una barrera infrarroja.

**Un solo controlador, dos destinos.** `src/estacion.js` es todo el comportamiento. Nunca toca el hardware directamente: solo usa la parte de Johnny-Five que recibe.

```
  aguacero.js ─► ojos (cada 60 s / 15 s) ─► cerebro.js ─► alerta VERDE…ROJO
                                                          │  (en campo: GET /alerta del servidor)
                                                          ▼
                                   ┌──────────────────────────────────────┐
                                   │ src/estacion.js   (las fauces)      │
                                   │ src/config.js     pines, calibración │
                                   └───────────────┬──────────────────────┘
                      five, board                  │                 five, board
           ┌───────────────────────────────────────┴───────────────────────────┐
┌──────────▼───────────┐                                         ┌─────────────▼────────────┐
│ hardware/run.js      │                                         │ sim/virtual-five.js      │
│ johnny-five + Arduino│                                         │ misma API, modelo físico │
│ Uno por USB          │                                         │ sim/escena.js (Three.js) │
└──────────────────────┘                                         └──────────────────────────┘
       maqueta real                                                    simulador.html
```

Lo que el controlador usa de Johnny-Five, comprobado contra el código de `johnny-five@2.1.0` y probado con el paquete real (ver Pruebas):

- `Servo({pin, range, startAt}).to()`
- `Motor({pin}).start(0–255)` y `.stop()`
- `Led.RGB({pins}).color([r,g,b])`
- `Pin(pin).high()` y `.low()`
- `Button({pin, isPullup})` con los eventos `press` y `release`
- `board.loop()`. El reloj **no** es `board.millis()`: en `johnny-five@2.1.0` devuelve solo la parte de nanosegundos de `process.hrtime` y vuelve a 0 cada segundo, lo que rompería los tiempos de atasco y de falta de datos. El controlador usa `performance.now()` y el simulador le inyecta su reloj. La placa virtual imita el `millis()` defectuoso para que ese error no vuelva a quedar oculto.

## Comportamiento

| Alerta / situación | Boca (rampa) | Banda | Ojos | Rugido |
|---|---|---|---|---|
| VERDE | cerrada: rampa en el agua | normal (PWM 150) | verde, respiración lenta | — |
| AMARILLO | cerrada | rápida (PWM 255) | amarillo fijo | — |
| NARANJA | cerrada | rápida | naranja, parpadeo 1 Hz | — |
| ROJO | **abierta**: se levanta y deja pasar la creciente | detenida | rojo, parpadeo 3 Hz | largo, al entrar |
| Cada kilo atrapado | — | — | — | corto |
| Barrera IR tapada > 3 s (atasco) | igual | detenida; reintenta 3 veces | morado | — |
| No llega alerta > 30 s | igual | sigue con la última | azul alternando | — |
| No llega alerta > 2 min | **abierta** (falla segura) | detenida | azul alternando | — |

Decisiones de seguridad:

- **Falla segura = boca abierta.** La lección de la Barricade en Guatemala es no quedar cerrado frente a una creciente. Por eso la boca se abre si se pierde la conexión y también al apagar el programa.
- **La boca abre rápido y cierra despacio** (30°/s). La banda solo arranca cuando la boca está cerrada.
- **Arranque suave de la banda** (600 ms), para evitar picos de corriente.
- **Antirrebote de 120 ms** en el contador, para no contar dos veces el mismo objeto.

## El cerebro y los umbrales

`src/cerebro.js` aplica las reglas de la especificación:

- **AMARILLO:** lluvia en 10 min.
- **NARANJA:** subida en cm/min.
- **ROJO:** cota de desborde de cada ojo.

La alerta sube de inmediato y solo baja tras 5 minutos, para que no parpadee. **Todos los umbrales de `src/config.js` son provisionales**, como pide el documento: se calibran con los datos de la Fase 1.

`src/aguacero.js` es un aguacero de demostración de 30 min con 5 ojos. Llueven ~46 mm, el ojo 5 sube hasta ~180 cm, y la secuencia es VERDE → NARANJA (min 3) → ROJO (min 13) → VERDE (min 31). Es un modelo simplificado y **sin calibrar**, solo para ferias y pruebas. También simula el envío del firmware del ojo: cada 60 s, y cada 15 s si el nivel sube más de 15 cm en 2 min.

## Materiales de la maqueta

| Cant. | Pieza | Para qué |
|---|---|---|
| 1 | Arduino Uno R3 con **StandardFirmata** | placa (Johnny-Five la controla por USB desde el portátil) |
| 1 | Servo MG996R | levantar la rampa (boca) |
| 1 | Motorreductor 12 V ~100 rpm (tipo JGA25-370) + tambor de 4 cm | banda |
| 4 | MOSFET logic-level IRLZ44N + diodo 1N4007 en el motor | banda y los 3 canales de la tira RGB |
| 1 | Tira LED RGB 12 V (cátodo común / sin direccionar) | ojos |
| 1 | Buzzer activo 12 V + transistor 2N2222 + 1 kΩ | rugido |
| 1 | Barrera infrarroja (emisor + receptor, salida colector abierto) | contador |
| 1 | Fuente 12 V 2 A + regulador 6 V 3 A (o fuente aparte) | motor, tira, buzzer / servo |

Los precios están por cotizar en Colombia.

## Cableado

| Arduino | → | Pieza |
|---|---|---|
| D9 | → | señal del servo (naranja) |
| D3 | → MOSFET → | motor de la banda (12 V) |
| D5 / D6 / D11 | → MOSFET → | canal rojo / verde / azul de la tira |
| D8 | → 1 kΩ → transistor → | buzzer (12 V) |
| D2 | ← | salida del receptor IR (Johnny-Five activa el pull-up; BAJO = haz cortado) |
| GND | — | **todas las tierras unidas**: Arduino, 12 V, 6 V |

Dos reglas que el simulador hace cumplir, porque dañan maquetas reales:

- **Nunca alimente el servo ni el motor desde el pin 5 V del Arduino.** Juntos pasan de 0,45 A. La placa se reinicia, Johnny-Five pierde Firmata y la rampa cae por su peso. En el simulador: *Alimentación → 5 V del Arduino*.
- **No hay PWM en D9/D10 con un servo conectado.** La librería Servo usa el Timer1. Por eso la banda y los ojos van en 3, 5, 6 y 11.

## Correr la maqueta real

1. Instale Node.js 20.14 o más nuevo (`brew install node`) y ejecute `npm install` en esta carpeta.
   La conexión USB usa `serialport@13`, que trae binarios precompilados. No hace falta compilar nada. Las dependencias opcionales de Johnny-Five (`serialport@8`) compilan código nativo, fallan en Node recientes y npm las salta sin avisar; por eso `hardware/conectar.js` abre el puerto con `serialport@13` + `firmata-io` y se lo entrega a Johnny-Five.
2. En el IDE de Arduino, cargue **StandardFirmata** (Archivo → Ejemplos → Firmata).
3. Calibre con `npm run calibrar`. Use `compuerta.to(g)` para encontrar la rampa tocando el agua y la rampa levantada, y anote los valores en `src/config.js`. Pese 30 objetos reales y ajuste `masaPromedioG`.
4. Corra la maqueta:
   - **En una feria, sin internet:** `npm run demo` corre el aguacero de 30 min en tiempo real; con `npm run demo -- --rapido 20` dura 90 s.
   - **Con el servidor de alertas:** `npm run maqueta -- --servidor http://localhost:8000` consulta `GET /alerta` cada 5 s. Espera un JSON como `{"nivel": "NARANJA", "motivo": "..."}`.
   - **Sin Arduino:** `npm run demo:sin-placa` corre todo con el hardware virtual.

Si la detección del puerto falla, use `CAIMAN_PORT=/dev/tty.usbmodemXXXX`. Si no hay Arduino, si el puerto está ocupado (por ejemplo, por el Monitor Serie del IDE) o si la placa no tiene StandardFirmata, el programa se detiene con un aviso en español. Ctrl+C deja la boca abierta y la banda quieta.

## Correr el simulador

Los módulos ES necesitan un servidor web:

```bash
python3 -m http.server 8766
```

Luego abra <http://localhost:8766/simulador.html>.

- La vista está a escala real, en el canal del arroyo Rebolo, con la desembocadura al caño y el manglar. Tiene barreras flotantes, lluvia, basura (botellas, bolsas, icopor, latas, chanclas) y los 5 ojos con su color de alerta.
- La electrónica es la de la maqueta 1:5. La velocidad de la banda se lleva a escala real con Froude (×√5).
- Por defecto el aguacero corre a ×20 (90 s, para ferias). Hay pausa, reinicio y sonido del rugido.
- El modelo de hardware:
  - el servo MG996R a 4,8 o 6 V, con el par de la rampa contra la gravedad (cambie la masa de la rampa para ver cuándo no alcanza);
  - el motor de la banda, con la carga de la basura;
  - el consumo de corriente;
  - la caída de tensión si se alimenta del Arduino.
- Fallas para probar:
  - una llanta atascada en la banda;
  - cortar la conexión con el cerebro;
  - reiniciar la placa.
- **Ver componentes** vuelve transparente la piel y muestra qué pin mueve cada parte.

## Pruebas

- **En Node:** `npm test` corre 21 pruebas.
  - 20 cubren el cerebro, el aguacero, la estación sobre el hardware virtual y un aguacero completo de punta a punta.
  - 1 es de integración: el **johnny-five real** + `firmata-io` real + `src/estacion.js`, contra un Arduino Uno con StandardFirmata emulado byte a byte (`test/uno-firmata.js`). Comprueba los modos de cada pin, el PWM de la banda con arranque suave, el pulso del servo en µs, el pull-up de la barrera IR, el conteo de objetos, el atasco con el reloj real, la boca abierta y el rugido en ROJO, y el apagado seguro.
- **En el navegador:** <http://localhost:8766/test/index.html> corre las 20 pruebas del hardware virtual.

## Qué falta o difiere de la especificación

- **Placa:** la especificación propone un ESP32 aparte para el caimán a escala. Aquí se usa Arduino Uno + Johnny-Five para que el **mismo código** corra en la maqueta y en el simulador. La lectura de `GET /alerta` la hace el portátil por WiFi.
- **Peso:** los kilos se **estiman** con la masa promedio por objeto. Para pesar de verdad hace falta una celda de carga en la panza.
- **Partes no incluidas:** el firmware de los ojos (PlatformIO), el servidor FastAPI y el tablero son otras partes de la Fase 1 y no están aquí. El cerebro en JavaScript replica sus reglas para la demo sin internet.
- **Endpoint propuesto:** `--reportar` envía `POST /estacion/basura`. La especificación solo define el `GET`, así que hay que acordarlo al construir el servidor.

## Archivos

```
src/config.js          pines, calibración y umbrales provisionales
src/estacion.js        el controlador: corre en la maqueta y en el simulador
src/cerebro.js         reglas de alerta VERDE/AMARILLO/NARANJA/ROJO
src/aguacero.js        aguacero de demostración + envío simulado de los ojos
hardware/run.js        maqueta real: --servidor, demo, --rapido, --sin-placa
hardware/conectar.js   busca el Arduino y abre el puerto (serialport@13 + firmata-io)
hardware/calibrar.js   REPL para calibrar rampa, banda, ojos, rugido e IR
sim/virtual-five.js    Uno, MG996R, motor DC, tira RGB, buzzer e IR virtuales
sim/escena.js          modelo 3D: canal, caño, barreras, ojos, caimán
sim/main.js            bucle de simulación, física de la basura, interfaz
simulador.html         página del simulador
test/                  pruebas (Node y navegador) y el Uno emulado (uno-firmata.js)
```
