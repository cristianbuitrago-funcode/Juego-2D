# Frontera — estrategia 2D multijugador en tiempo real

Juego de estrategia en tiempo real para navegador (PC, Android y tablet) con **multijugador online real**:
servidor autoritativo, lobby con código de sala, niebla de guerra, economía, construcción, combate e IA cooperativa.
Todos los gráficos son procedurales (sin assets de terceros).

## Puesta en marcha

Requisitos: **Node.js 20 o superior**.

```bash
npm install
npm run dev        # servidor de juego (puerto 3000) + cliente Vite (http://localhost:5173)
```

Abre `http://localhost:5173` en dos pestañas o en dos dispositivos de la misma red
(`http://IP-DE-TU-PC:5173`), crea una partida en una y únete con el código en la otra.

Producción (un solo proceso sirve cliente y servidor):

```bash
npm run build
npm start          # http://localhost:3000
```

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Tests de simulación (movimiento, combate, recursos, seguridad, niebla, IA, puntos de control) y de red (lobby, sincronización, trampas, reconexión, fin de partida, límite de órdenes) |
| `npm run typecheck` | Comprobación de tipos de todo el proyecto |
| `npm run test:e2e` | Pruebas con navegador real (requiere `npm run build && npm start` en otra terminal) |

## Tecnología elegida y por qué

| Pieza | Elección | Motivo |
|---|---|---|
| Lenguaje | **TypeScript** en cliente, servidor y código compartido | Los mismos tipos y catálogos (unidades, edificios, mensajes) en ambos lados: imposible desincronizarlos |
| Red | **Socket.IO** (WebSocket) | Para una primera versión es lo más fiable: salas, reconexión automática, *acks* y *fallback* a long-polling en redes que bloquean WebSocket. WebRTC (P2P) no encaja con un servidor autoritativo y complica NAT/ICE |
| Servidor | **Node.js + Express** | Mismo lenguaje que el cliente; un solo proceso sirve el juego y los archivos estáticos |
| Render | **Canvas 2D** + interfaz DOM | Sin dependencias pesadas, rápido en móviles y fácil de empaquetar para Android (Capacitor/WebView) |
| Build | **Vite** (cliente) y **esbuild** (servidor) | Rápidos y sin configuración compleja |

## Arquitectura

```
CLIENTE (navegador/Android)          SERVIDOR (Node, autoritativo)           CLIENTE
  entrada → órdenes ───────────────▶  validación → simulación 20 Hz  ◀─────── órdenes
  render ◀── snapshot delta 10 Hz ──  visión por equipo → deltas     ──────▶  render
```

```
shared/            Código común cliente/servidor
  types/           Tipos de dominio (game.ts) y protocolo de red (messages.ts)
  constants/       Catálogos: terrenos, unidades, tecnologías, edificios
  config/          Parámetros globales (gameConfig.ts) y modos de juego (gameModes.ts)
  utils/           Matemáticas, RNG determinista, cálculo de territorio
server/src/
  index.ts         Arranque HTTP + Socket.IO
  network/         SocketServer (eventos), validation (validación + anti-spam), SnapshotBuilder (deltas por jugador)
  rooms/           Room (lobby + bucle de partida), RoomManager (códigos de sala)
  players/         PlayerState (estado en partida), RoomPlayer (plaza en la sala + token de reconexión)
  game/            Game (orquesta sistemas), GameState (estado centralizado), GameMap, MapGenerator,
                   CommandHandler (valida y aplica TODAS las órdenes), entities
  systems/         Unit, Movement, Pathfinding (A*), Combat, Economy, Resource (gestor centralizado),
                   Production, ControlPoint, Vision (niebla de guerra), Victory
  ai/              AIController (IA del modo cooperativo)
client/src/
  main.ts          Arranque: conecta red, lobby y partida
  GameSession.ts   Bucle de partida (render, entrada, HUD, eventos)
  network/         NetworkClient (Socket.IO, reconexión, ping)
  systems/         ClientWorld (copia local + interpolación + niebla visual), Camera, InputController
                   (ratón/teclado/táctil), Selection (selección y grupos), Settings (preferencias y progresión local)
  components/      GameRenderer, MapRenderer (terreno pre-renderizado), Minimap, Effects
  entities/        sprites.ts: gráficos procedurales de unidades, edificios y recursos (+ iconos)
  ui/              LobbyScreen, Hud, Menus (pausa, ajustes, controles, victoria/derrota), estilos
  assets/          AudioManager (sonido), palette
tests/             Tests de simulación y de red (node:test) + E2E con Playwright
```

### Estado del juego (GameState)

`server/src/game/GameState.ts` es la **única fuente de verdad**: partida (modo, tiempo, fase, ganador),
jugadores (recursos, población, tecnologías, estadísticas), entidades (unidades, edificios, yacimientos),
territorio (derivado de los edificios y cacheado), puntos de control y visibilidad por equipo.
Los sistemas son funciones que leen/modifican ese estado en un orden fijo cada tick (`Game.step`).

Los recursos solo se modifican a través de `ResourceSystem` (`spend`, `add`, `refund`, `recompute`).

## Cómo funciona el multijugador

1. **Lobby**: el anfitrión crea una sala y recibe un código de 5 caracteres. Los demás se unen con él.
   Cada jugador marca «Listo» y el anfitrión inicia. 2–4 jugadores (1–3 humanos en cooperativo).
2. **Simulación autoritativa**: el servidor ejecuta la partida a 20 ticks/s. El cliente solo envía
   *intenciones* (`move`, `attack`, `build`, `train`, …). El servidor valida:
   propiedad de las unidades, costes, población, requisitos, colocación dentro del territorio,
   terreno, alcance, visibilidad del objetivo, daño y condiciones de victoria.
   Un cliente modificado no puede darse recursos, mover unidades ajenas ni ver a través de la niebla.
3. **Sincronización eficiente**: 10 veces/s cada jugador recibe un **snapshot delta**: solo las entidades
   visibles para su equipo que cambiaron, la lista de las que dejaron de verse, su estado privado si cambió
   y los eventos (ataques, muertes, construcciones…) que ocurrieron en zonas que ve. El cliente interpola
   posiciones entre snapshots para que el movimiento sea fluido.
4. **Niebla de guerra**: calculada en el servidor por equipo; las unidades en bosque solo se detectan
   a corta distancia (o al atacar). El cliente recuerda edificios enemigos ya vistos («fantasmas»).
5. **Desconexión**: el jugador tiene 60 s para volver (al recargar o reconectar se reincorpora automáticamente
   con su token de sesión). Pasado ese tiempo queda eliminado. Salir desde el menú cuenta como rendición.
6. **Protección**: validación estricta de cada mensaje, límite de 25 órdenes/s por jugador,
   tamaño máximo de mensaje y sanitización de nombres y códigos.

## Qué está implementado

- Lobby: crear partida, código, unirse, lista de jugadores, «listo», ajustes (modo, tamaño de mapa, dificultad IA), anfitrión.
- Mapa procedural simétrico (justo para 2–4 jugadores) con hierba, tierra, caminos (más rápidos), agua (intransitable),
  montañas (muy lentas, no edificables), bosques (lentos y ocultan), zonas de recursos y puntos estratégicos. 3 tamaños.
- Recursos: oro, madera, piedra y comida, con almacenamiento máximo y población.
- 8 edificios con vida, coste, tiempo de construcción, estado, nivel (hasta 3) y función:
  centro de mando, cuartel, mina (junto a oro/piedra), aserradero (junto a bosque), granja, almacén, torre defensiva, centro tecnológico.
- 5 unidades: recolector, soldado, explorador, arquero (cuartel nv. 2) y tanque (cuartel nv. 3 + centro tecnológico).
- 3 tecnologías con 2 niveles (daño, defensa, recolección/producción).
- Combate: alcance, aproximación, daño con defensa, muerte, proyectiles, animaciones, prioridades de objetivo,
  ataque-movimiento, mantener posición, retirada, adquisición automática con correa (no persiguen indefinidamente).
- Recolectores: ciclo de recolección, ayuda a construir, reparación (cuesta madera y piedra).
- Control: selección por clic/área/doble clic, grupos, órdenes contextuales, atajos de teclado, controles táctiles.
- Cámara: WASD/flechas, bordes, zoom (rueda/pellizco), arrastre (botón central o un dedo), límites del mapa.
- Minimapa: territorio propio y enemigo descubierto, unidades, enemigos visibles, puntos estratégicos, alertas; clic mueve la cámara y clic derecho envía unidades.
- Modos: **Batalla**, **Control territorial**, **Cooperativo** (contra IA) y dos experimentales (**Carrera económica**, **Dominio**).
- IA cooperativa: recolecta, construye, entrena, mejora, investiga, defiende, explora y lanza oleadas.
- Interfaz: barra superior (recursos, población, tiempo, ping), panel inferior (selección, órdenes, construcción/entrenamiento),
  minimapa lateral, menú de pausa, configuración, controles, pantallas de victoria/derrota.

## Placeholders y limitaciones conocidas (honestamente)

- **Sonido**: todos los sonidos y la «música» son tonos sintetizados con WebAudio. Para usar archivos reales,
  colócalos en `client/public/audio/` y regístralos en `SOUND_FILES` (`client/src/assets/AudioManager.ts`).
- **Progresión del jugador**: nivel/XP/victorias se guardan **solo en el navegador** (localStorage).
  Una progresión real requiere cuentas y base de datos (no implementado).
- **Menú de pausa**: en online la partida **no se detiene** (hay otros jugadores); el menú lo indica.
- **IA**: básica. Conoce la posición inicial de las bases enemigas para dirigir sus oleadas.
- **Escalado**: las salas viven en memoria de un único proceso. Para varias instancias haría falta
  un adaptador (p. ej. Redis) y afinidad de sesión.
- **Android**: el cliente es web responsivo y táctil; el empaquetado como app nativa no está hecho (pasos abajo).
- No hay colisión física estricta entre unidades (se usa separación suave) ni formaciones avanzadas.

## Controles

Ratón y teclado: clic selecciona (Shift añade), arrastrar selecciona área, doble clic selecciona el mismo tipo,
clic derecho = orden contextual (mover / atacar / recolectar / reparar / punto de reunión),
**A** ataque-movimiento, **M** mover, **X** detener, **H** mantener, **R** retirarse, **Q** todo el ejército,
**Ctrl/Shift+1..9** guardar grupo, **1..9** recuperarlo (doble pulsación centra), **WASD/flechas** cámara
(A solo mueve la cámara si no hay unidades seleccionadas), rueda zoom, **Espacio** ir a la última alerta, **Esc** cancelar/pausa.

Táctil: toque selecciona; con unidades seleccionadas, toque en terreno mueve, en enemigo ataca, en recurso recolecta;
mantener pulsado y arrastrar = selección por área; un dedo mueve la cámara; pellizcar = zoom;
botones «Nada», «Multi», «Ejército», «Base» y grupos en pantalla.

## Despliegue online (para jugar desde distintos dispositivos)

El servidor necesita un hosting que soporte **WebSockets y procesos Node persistentes**
(Render, Railway, Fly.io, un VPS…). No sirve un hosting estático (GitHub Pages, Netlify estático).

Ejemplo con **Render**:
1. Sube el repositorio a GitHub.
2. En Render: *New → Web Service*, conecta el repositorio.
3. Build command: `npm install && npm run build` · Start command: `npm start`.
4. Render asigna `PORT` automáticamente. Abre la URL pública en cualquier dispositivo.

Variables de entorno (ver `.env.example`):
- `PORT`: puerto (por defecto 3000).
- `CORS_ORIGINS`: solo si el cliente se sirve desde otro dominio (p. ej. la app Android), separado por comas.
- `VITE_SERVER_URL`: en tiempo de build del cliente, URL del servidor cuando el cliente no se sirve desde él.
  También se puede probar con `?server=https://mi-servidor` en la URL.

## GitHub Pages + servidor en Google Cloud Run (Firebase)

GitHub Pages **solo sirve archivos estáticos**: puede alojar el cliente, pero no el servidor de juego
(no ejecuta Node ni mantiene WebSockets). Lo mismo ocurre con Firebase Hosting y, en la práctica,
con Cloud Functions (no mantienen un bucle de simulación continuo de 20 ticks/s).
Usar Firestore/Realtime Database como "servidor" obligaría a que los clientes escriban el estado
del juego y se perdería la autoridad del servidor (recursos, daño y victoria quedarían en manos del cliente).

La opción recomendada con Google/Firebase es **Cloud Run** (mismo proyecto de Firebase, requiere el plan Blaze
con facturación activada; tiene un nivel gratuito mensual). El repositorio ya incluye `Dockerfile` y
`.github/workflows/pages.yml`.

### 1. Servidor en Cloud Run
1. Instala la CLI de Google Cloud (`gcloud`) e inicia sesión: `gcloud auth login`.
2. Selecciona el proyecto de Firebase: `gcloud config set project TU-PROYECTO`.
3. Desde la carpeta del repositorio:
   ```bash
   gcloud run deploy frontera \
     --source . --region europe-west1 --allow-unauthenticated \
     --max-instances 1 --session-affinity --timeout 3600 \
     --set-env-vars CORS_ORIGINS=https://TU-USUARIO.github.io
   ```
   - `--max-instances 1`: las salas viven en memoria; todos los jugadores deben llegar a la misma instancia.
   - `--timeout 3600`: las conexiones WebSocket pueden durar hasta 60 min (el cliente se reconecta solo si se cortan).
4. Anota la URL que devuelve (p. ej. `https://frontera-xxxx.a.run.app`). Comprueba `https://…/health`.

### 2. Cliente en GitHub Pages
1. En GitHub: *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
2. *Settings → Secrets and variables → Actions → Variables → New repository variable*:
   `SERVER_URL` = la URL de Cloud Run.
3. Haz merge a `main` (o lanza el workflow «Publicar cliente en GitHub Pages» a mano desde *Actions*).
4. El juego queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

Alternativa gratuita sin tarjeta: el mismo servidor en **Render** (sección anterior); en ese caso pon la URL de Render en `SERVER_URL`
y su `CORS_ORIGINS` con tu dominio de GitHub Pages. En el plan gratuito de Render el servidor se duerme tras 15 min sin uso
y tarda unos segundos en despertar.

## Pasos para Android (no implementado todavía)

La arquitectura ya está preparada (cliente web táctil, URL de servidor configurable). Para generar el APK con Capacitor:

1. Despliega el servidor (sección anterior) y anota su URL, p. ej. `https://frontera.onrender.com`.
2. En el servidor define `CORS_ORIGINS=capacitor://localhost,http://localhost,https://localhost`.
3. Compila el cliente apuntando al servidor: `VITE_SERVER_URL=https://frontera.onrender.com npm run build:client`.
4. `npm i -D @capacitor/cli @capacitor/core @capacitor/android`
5. `npx cap init Frontera com.tu.frontera --web-dir dist/client`
6. `npx cap add android && npx cap sync android`
7. `npx cap open android` (requiere Android Studio) y genera el APK/AAB.

## Cómo ampliar

- **Unidad nueva**: añade el tipo a `UnitType` (`shared/types/game.ts`), su entrada en `UNIT_DEFS`
  y en `trains` del edificio que la entrene. Dibújala en `client/src/entities/sprites.ts` (si no, usa el aspecto genérico).
- **Edificio nuevo**: `BuildingType` + `BUILDING_DEFS` + su dibujo en `drawBuilding`.
- **Terreno nuevo**: enum `Terrain` + `TERRAIN_DEFS` (velocidad, edificable, ocultación, colores).
- **Modo de juego nuevo**: entrada en `GAME_MODES` combinando condiciones de victoria; si necesitas una condición nueva,
  añádela a `VictoryCondition` y a `VictorySystem.evaluate`.
- **Mapa más grande / hecho a mano**: `MAP_SIZES` en `gameConfig.ts`, o pasa un `MapData` propio a `new Game(...)`.
- **Más jugadores**: `maxPlayers` en los modos y más puntos de aparición en el generador de mapas.
