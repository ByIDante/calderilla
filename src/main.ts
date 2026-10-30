import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { cargarAjustes, carpetaAjustes, guardarAjustes, rutaTrabajo } from "./config/ajustes.ts";
import { haySincronizacionPendiente, sincronizarBancos } from "./bancos/conexiones.ts";
import { esPaquete, ultimaVersion } from "./config/actualizar.ts";
import { RAIZ, versionInstalada } from "./config/version.ts";
import { Sincronizador } from "./datos/sync.ts";
import { actualizarPrecios, hayQueActualizar } from "./precios/actualizar.ts";
import { hoy } from "./dominio/fechas.ts";
import { crearApp, type Estado } from "./servidor/app.ts";
import { prepararBase } from "./servicios/semillas.ts";

const ajustes = cargarAjustes();

// Abierta sin ventana (acceso directo), lo que escribe en la consola se pierde: también va a un archivo
const registro = path.join(carpetaAjustes(), "calderilla.log");
if (existsSync(registro) && statSync(registro).size > 1_000_000) rmSync(registro);
for (const nivel of ["log", "warn", "error"] as const) {
  const original = console[nivel].bind(console);
  console[nivel] = (...partes: unknown[]) => {
    original(...partes);
    try {
      appendFileSync(registro, `${new Date().toISOString()} ${partes.map((p) => (p instanceof Error ? (p.stack ?? p.message) : String(p))).join(" ")}\n`);
    } catch {
      // sin registro no pasa nada
    }
  };
}

const estado: Estado = {
  ajustes,
  sync: null,
  // Token nuevo en cada arranque: protege los formularios frente a otras webs abiertas en el navegador
  token: randomBytes(24).toString("base64url"),
  hoy,
  errorFatal: null,
  usarCarpeta(carpeta) {
    // Antes de cambiar de carpeta se deja guardado lo pendiente en la anterior
    estado.sync?.cerrar();
    estado.sync = null;
    const sync = new Sincronizador({
      carpetaDatos: carpeta,
      rutaTrabajo: rutaTrabajo(),
      equipoId: ajustes.equipoId,
      equipoNombre: ajustes.equipoNombre,
      alAbrir: prepararBase,
    });
    sync.comprobar();
    estado.sync = sync;
    ajustes.carpetaDatos = carpeta;
    guardarAjustes(ajustes);
  },
  guardarAjustes,
  salir: () => salir(),
  reiniciar: () => salir(true),
};

// Si se instala una versión nueva con la app abierta, se avisa para reiniciar
const versionAlArrancar = versionInstalada();

if (ajustes.carpetaDatos) {
  try {
    estado.usarCarpeta(ajustes.carpetaDatos);
  } catch (error) {
    estado.errorFatal = (error as Error).message;
    console.error("No se pudieron abrir los datos:", estado.errorFatal);
  }
}

const url = `http://127.0.0.1:${ajustes.puerto}/`;

function abrirNavegador(direccion: string) {
  if (!ajustes.abrirNavegador) return;
  const [orden, argumentos] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", direccion]] : process.platform === "darwin" ? ["open", [direccion]] : ["xdg-open", [direccion]];
  try {
    spawn(orden, argumentos, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // Sin navegador (p. ej. en un servidor): basta con la dirección que se muestra en la consola
  }
}

// Al reiniciar, la versión anterior tarda un momento en soltar el puerto: se reintenta en vez de rendirse
const reiniciando = process.env.CALDERILLA_REINICIO === "1";
let intentos = 0;

const servidor = serve({ fetch: crearApp(estado).fetch, hostname: "127.0.0.1", port: ajustes.puerto }, () => {
  console.log(`Calderilla está abierta en ${url}`);
  console.log(`Datos: ${ajustes.carpetaDatos ?? "(aún sin carpeta)"} · Ajustes de este ordenador: ${carpetaAjustes()}`);
  console.log("Para salir, cierra esta ventana, pulsa Ctrl+C o usa Ajustes → Cerrar Calderilla.");
  if (!reiniciando) abrirNavegador(url);
});

servidor.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE" && reiniciando && intentos++ < 40) {
    setTimeout(() => servidor.listen(ajustes.puerto, "127.0.0.1"), 250);
    return;
  }
  if (error.code === "EADDRINUSE") {
    // Ya hay una Calderilla abierta (doble clic dos veces): se abre la existente en el navegador
    console.log(`Calderilla ya está abierta en ${url}`);
    abrirNavegador(url);
    process.exit(0);
  }
  throw error;
});

/** Precios automáticos y tipos de cambio, como mucho cada 12 horas y sin bloquear la app. */
let actualizando = false;
function actualizarPreciosSiToca() {
  const sync = estado.sync;
  if (actualizando || !sync || !hayQueActualizar(sync.bd)) return;
  actualizando = true;
  actualizarPrecios(() => estado.sync!.bd, { hoy: hoy(), coingeckoClave: ajustes.coingeckoClave })
    .then((informe) => {
      if (informe.errores.length) console.warn("Precios que no se pudieron actualizar:", informe.errores.join(" · "));
      estado.sync?.programarEnvio();
    })
    .catch((error: Error) => console.warn("No se pudieron actualizar los precios:", error.message))
    .finally(() => (actualizando = false));
}
actualizarPreciosSiToca();

/** Saldos y movimientos de los bancos vinculados, como mucho cada 12 horas. */
let sincronizandoBancos = false;
function sincronizarBancosSiToca() {
  if (sincronizandoBancos || !estado.sync || !haySincronizacionPendiente()) return;
  sincronizandoBancos = true;
  sincronizarBancos(() => estado.sync!.bd, hoy())
    .then((informe) => {
      if (informe.errores.length) console.warn("Bancos:", informe.errores.join(" · "));
      estado.sync?.programarEnvio();
    })
    .catch((error: Error) => console.warn("No se pudo sincronizar con el banco:", error.message))
    .finally(() => (sincronizandoBancos = false));
}
sincronizarBancosSiToca();

/** El paquete para Windows mira en GitHub si hay versión nueva cada 6 horas (al abrirlo ya lo ha hecho el lanzador). */
const paquete = esPaquete(RAIZ);
let ultimaComprobacion = Date.now();
function buscarVersionNuevaSiToca() {
  if (!paquete || estado.versionNueva || Date.now() - ultimaComprobacion < 6 * 3_600_000) return;
  ultimaComprobacion = Date.now();
  void ultimaVersion().then((sha) => {
    if (sha && sha !== versionInstalada()) estado.versionNueva = "disponible";
  });
}

// Cada minuto se mira si hay cambios de otro ordenador y se guarda lo pendiente
setInterval(() => {
  if (!estado.versionNueva && versionAlArrancar !== null && versionInstalada() !== versionAlArrancar) estado.versionNueva = "instalada";
  buscarVersionNuevaSiToca();
  estado.sync?.comprobar();
  actualizarPreciosSiToca();
  sincronizarBancosSiToca();
}, 60_000);

let cerrando = false;
/**
 * Guarda lo pendiente y sale. Con `volver`, antes deja lanzada otra Calderilla (con la versión nueva). En
 * Windows se vuelve a abrir con el lanzador, que instala lo que falte (versión nueva, dependencias).
 */
function salir(volver = false) {
  if (cerrando) return;
  cerrando = true;
  try {
    estado.sync?.cerrar();
    if (volver) {
      const lanzador = path.join(RAIZ, "Calderilla.vbs");
      const [orden, argumentos] = process.platform === "win32" && existsSync(lanzador) ? ["wscript.exe", [lanzador]] : [process.execPath, process.argv.slice(1)];
      spawn(orden, argumentos, {
        cwd: RAIZ,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, CALDERILLA_REINICIO: "1" },
      }).unref();
    }
  } finally {
    process.exit(0);
  }
}
// SIGHUP llega en Windows al cerrar la ventana de la consola; SIGBREAK con Ctrl+Pausa
for (const senal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.on(senal, () => salir());
