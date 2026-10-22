# Proyecto CAIMÁN · Caimán 1 a escala 1:5

**Simulador en línea:** <https://claudemoneymax123-sudo.github.io/caiman-simulador/> · **Veredicto del comité de revisión:** <https://claudemoneymax123-sudo.github.io/caiman-simulador/comite.html>

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
| Al encender | **abierta** y cierra despacio | quieta hasta cerrar | verde tenue | — |
| VERDE | cerrada: rampa en el agua | normal (PWM 150) | verde, respiración lenta | — |
| AMARILLO | cerrada | rápida (PWM 255) | amarillo fijo | — |
| NARANJA | cerrada | rápida | naranja, parpadeo 1 Hz | — |
| ROJO | **abierta**: se levanta y deja pasar la creciente | detenida | rojo, parpadeo 3 Hz | largo, al entrar |
| Cada kilo atrapado | — | — | — | corto |
| Barrera IR tapada > 3 s (atasco), también sin datos | igual | detenida; reintenta 3 veces | morado | al agotar los reintentos |
| No llega alerta > 30 s | igual | sigue con la última | azul alternando con la última | — |
| No llega alerta > 2 min | **abierta** (falla segura) | detenida | **solo azul** (nunca verde) | largo, al abrir |

Decisiones de seguridad:

- **Falla segura = boca abierta.** La lección de la Barricade en Guatemala es no quedar cerrado frente a una creciente. Por eso la boca se abre si se pierde la conexión, al apagar el programa (Ctrl+C, cierre o error) y, **sin corriente, por el contrapeso** (ver Materiales).
- **Al encender, la boca arranca abierta** y el ciclo la cierra a 30°/s: un servo de hobby no sabe dónde quedó, así que un reinicio nunca la deja caer de golpe.
- **"No sé" no es "no hay peligro".** Un ojo sin lecturas en 3 min se marca "sin datos"; si ningún ojo tiene datos, la estación no recibe una alerta VERDE sino nada, y entra en su falla segura.
- **La boca abre rápido y cierra despacio** (30°/s). La banda solo arranca cuando la boca está cerrada.
- **Arranque suave de la banda** (600 ms), para evitar picos de corriente.
- **Antirrebote de 120 ms, de ventana deslizante:** una bolsa que aletea cuenta una vez; dos objetos pegados también cuentan como uno (con una sola barrera no se pueden separar).
- **El servidor puede mandar `"rojo "` en minúsculas o con espacios:** la estación lo entiende. Un nivel desconocido cuenta como "sin datos".

## El cerebro y los umbrales

`src/cerebro.js` aplica las reglas de la especificación:

- **AMARILLO:** lluvia en 10 min.
- **NARANJA:** subida en cm/min.
- **ROJO:** cota de desborde de cada ojo.

La alerta sube de inmediato y **baja un escalón cada 5 minutos** (ROJO → NARANJA → AMARILLO → VERDE), para que nadie pase de ROJO a VERDE con el agua todavía alta. El color de cada ojo tiene la misma retención, así que no parpadea cuando el nivel ronda la cota. **Todos los umbrales de `src/config.js` son provisionales**, como pide el documento: se calibran con los datos de la Fase 1.

`src/aguacero.js` es un aguacero de demostración: 30 min de lluvia y 30 de bajada, con 5 ojos. Llueven ~47 mm; los primeros 5 mm no escurren (charcos y andenes). El ojo 5 sube hasta ~171 cm y la secuencia es VERDE → AMARILLO (min 6) → NARANJA (min 7) → ROJO (min 17) → NARANJA (min 32) → AMARILLO (min 37) → VERDE (min 42). Es un modelo simplificado y **sin calibrar**, solo para ferias y pruebas; el periodo de retorno de ese aguacero está por verificar con las curvas IDF del IDEAM. También simula el envío del firmware del ojo: cada 60 s, y cada 15 s si el nivel sube más de 15 cm en 2 min.

La velocidad del agua sale de la ecuación de Manning para el canal trapezoidal (concreto, n = 0,015). La pendiente S0 = 0,002 es un **supuesto** hasta medirla con flotadores en campo.

## Materiales de la maqueta

| Cant. | Pieza | Para qué |
|---|---|---|
| 1 | Arduino Uno R3 con **StandardFirmata** | placa (Johnny-Five la controla por USB desde el portátil) |
| 1 | Servo MG996R (o uno IP67 de ~25 kg·cm cerca del agua) | levantar la rampa (boca) |
| 1 | **Contrapeso** detrás de la bisagra (~0,18 kg·m: unos 360 g a 0,5 m) | sin corriente, la rampa sube sola (falla segura) |
| 1 | Motorreductor 12 V ~100 rpm (tipo JGA25-370) + tambor de 4 cm | banda |
| 4 | MOSFET logic-level IRLZ44N, cada uno con 10 kΩ de compuerta a GND y 100–220 Ω en serie | banda y los 3 canales de la tira RGB (no arrancan solos durante el reinicio del Uno) |
| 1 | Diodo Schottky 1N5819 o SS34 + condensador cerámico de 100 nF en los bornes del motor | protección del motor (menos ruido que un 1N4007) |
| 1 | Tira LED RGB 12 V de **ánodo común** (+12 V compartido, sin direccionar) | ojos (con MOSFET del lado bajo, la de cátodo común no enciende) |
| 1 | Buzzer activo 12 V + transistor 2N2222 + 1 kΩ | rugido |
| 1 | Barrera infrarroja **modulada** (receptor tipo TSOP4038 + emisor a 38 kHz) con visera negra de 3 cm a cada lado | contador (una barrera simple se satura con el sol o las lámparas de la feria) |
| 1 | Fuente 12 V 2 A + convertidor buck de 6 V 5 A (tipo XL4015) + condensador de 1000 µF / 10 V junto al servo | motor, tira y buzzer / servo |
| — | Rampa y casco impresos en **PETG o ASA** (el PLA se deforma al sol); tornillería inoxidable; bujes de POM o UHMW-PE | estructura |

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

Reglas que el simulador hace cumplir, porque dañan maquetas reales:

- **Nunca alimente el servo ni el motor desde el pin 5 V del Arduino.** Juntos pasan de 0,45 A. La placa se reinicia y deja de obedecer; sin contrapeso, la rampa cae cerrada por su peso. En el simulador: *Alimentación → 5 V del Arduino*.
- **No hay PWM en D9/D10 con un servo conectado.** La librería Servo usa el Timer1. Por eso la banda y los ojos van en 3, 5, 6 y 11.

Para que funcione en una feria (lo que más falla son los cables):

- Cable de señal del servo trenzado con su GND, de 50 cm como máximo; una ferrita en el cable del motor.
- Retorno del motor por un cable propio hasta la fuente (tierra en estrella).
- Resistencia externa de 4,7 kΩ de pull-up en D2 si el cable de la barrera mide más de 1 m.
- Caja IP54 para el Uno y los MOSFET, conectores polarizados (JST-XH o GX12), fusible de 3 A en los 12 V y el cable USB amarrado.
- **Pendiente para la Fase 1:** si se desconecta el USB, StandardFirmata deja la banda girando. Se recomienda un "latido" (un pin que cambia en cada ciclo) que mantenga habilitado el MOSFET de la banda con un monoestable (555 o 74HC123, ~300 ms).

## Correr la maqueta real

1. Instale Node.js 20.14 o más nuevo (en Mac `brew install node`; en Windows, el instalador LTS de nodejs.org) y ejecute `npm ci` en esta carpeta (instala exactamente las versiones probadas).
   La conexión USB usa `serialport@13`, que trae binarios precompilados. No hace falta compilar nada. Las dependencias opcionales de Johnny-Five (`serialport@8`) compilan código nativo, fallan en Node recientes y npm las salta sin avisar; por eso `hardware/conectar.js` abre el puerto con `serialport@13` + `firmata-io` y se lo entrega a Johnny-Five.
2. En el IDE de Arduino, cargue **StandardFirmata** (Archivo → Ejemplos → Firmata).
3. Calibre con `npm run calibrar`. Use `compuerta.to(g)` para encontrar la rampa tocando el agua y la rampa levantada, y anote los valores en `src/config.js`. Pese 30 objetos reales y ajuste `masaPromedioG`.
4. Corra la maqueta:
   - **En una feria, sin internet:** `npm run demo` corre el aguacero (30 min de lluvia + 30 de bajada) en tiempo real; con `npm run demo -- --rapido 20` dura 3 min.
   - **Con el servidor de alertas:** `npm run maqueta -- --servidor http://localhost:8000` consulta `GET /alerta` en seguida y luego cada 5 s. Espera un JSON como `{"nivel": "NARANJA", "motivo": "..."}`. Si el servidor también manda `"sinDatos": true`, `"ojosVivos": 0` o una hora `"t"` de hace más de 30 s, la estación no renueva la alerta y entra en su falla segura. Si el servidor pide clave, póngala en `CAIMAN_TOKEN`.
   - **Sin Arduino:** `npm run demo:sin-placa` corre todo con el hardware virtual.

Si la detección del puerto falla, use `CAIMAN_PORT=/dev/tty.usbmodemXXXX` (en Windows, `CAIMAN_PORT=COM3`). Si no hay Arduino, si el puerto está ocupado (por ejemplo, por el Monitor Serie del IDE) o si la placa no tiene StandardFirmata, el programa se detiene con un aviso en español. Ctrl+C deja la boca abierta y la banda quieta.

## Correr el simulador

Los módulos ES necesitan un servidor web. **Funciona sin internet**: Three.js 0.160.0 viene dentro del proyecto (`vendor/`).

```bash
python3 -m http.server 8766
```

Luego abra <http://localhost:8766/simulador.html>. Con `?calidad=baja` en la dirección se aligera el 3D (los celulares lo usan solos), y con `?semilla=123` se repite exactamente la misma basura.

- La vista está a escala real, en el canal del arroyo Rebolo, con la desembocadura al caño y el manglar. Tiene barreras flotantes, lluvia, basura (botellas, bolsas, icopor, latas, chanclas) y los 5 ojos con su color de alerta.
- La electrónica es la de la maqueta 1:5. La velocidad de la banda se lleva a escala real con Froude (×√5).
- Empieza con una tarjeta con los datos del proyecto y un botón "Ver un aguacero" (ese clic activa el sonido). Por defecto corre a ×20 (3 min) y al terminar empieza otro solo.
- La pantalla muestra el consejo para la gente en cada alerta, los **minutos de aviso**, lo que se comió el caimán por tipo y el error del contador frente a lo atrapado de verdad.
- El modelo de hardware:
  - el servo MG996R a 4,8 o 6 V, con el par neto de la rampa y su contrapeso (cambie la masa de la rampa para ver cuándo no alcanza);
  - el motor de la banda, con la carga de la basura;
  - el consumo de corriente;
  - la caída de tensión si se alimenta del Arduino.
- Fallas para probar:
  - una llanta atascada en la banda;
  - cortar la conexión con el cerebro;
  - apagar uno de los 5 ojos;
  - reiniciar la placa.
- **Ver componentes** vuelve transparente la piel y muestra qué pin mueve cada parte.

## Pruebas

- **En Node:** `npm test` corre 33 pruebas. GitHub Actions las corre en cada cambio con Node 20, 22 y 24.
  - 32 cubren el cerebro, el aguacero, la estación sobre el hardware virtual, las fallas y un aguacero completo de punta a punta.
  - 1 es de integración: el **johnny-five real** + `firmata-io` real + `src/estacion.js`, contra un Arduino Uno con StandardFirmata emulado byte a byte (`test/uno-firmata.js`). Comprueba los modos de cada pin, el PWM de la banda con arranque suave, el pulso del servo en µs, el pull-up de la barrera IR, el conteo de objetos, el atasco con el reloj real, la boca abierta y el rugido en ROJO, y el apagado seguro.
- **En el navegador:** <http://localhost:8766/test/index.html> corre las 32 pruebas del hardware virtual.

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
vendor/three@0.160.0/  Three.js dentro del proyecto (funciona sin internet)
comite.html            veredicto del comité de 50 especialistas
```
