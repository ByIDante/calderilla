import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { cargarAjustes, carpetaAjustes, guardarAjustes, rutaTrabajo } from "./config/ajustes.ts";
import { Sincronizador } from "./datos/sync.ts";
import { hoy } from "./dominio/fechas.ts";
import { crearApp, type Estado } from "./servidor/app.ts";
import { prepararBase } from "./servicios/semillas.ts";

const ajustes = cargarAjustes();

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
};

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

const servidor = serve({ fetch: crearApp(estado).fetch, hostname: "127.0.0.1", port: ajustes.puerto }, () => {
  console.log(`Calderilla está abierta en ${url}`);
  console.log(`Datos: ${ajustes.carpetaDatos ?? "(aún sin carpeta)"} · Ajustes de este ordenador: ${carpetaAjustes()}`);
  console.log("Para salir, cierra esta ventana o pulsa Ctrl+C.");
  abrirNavegador(url);
});

servidor.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    // Ya hay una Calderilla abierta (doble clic dos veces): se abre la existente en el navegador
    console.log(`Calderilla ya está abierta en ${url}`);
    abrirNavegador(url);
    process.exit(0);
  }
  throw error;
});

// Cada minuto se mira si hay cambios de otro ordenador y se guarda lo pendiente
setInterval(() => estado.sync?.comprobar(), 60_000);

let cerrando = false;
function salir() {
  if (cerrando) return;
  cerrando = true;
  try {
    estado.sync?.cerrar();
  } finally {
    process.exit(0);
  }
}
// SIGHUP llega en Windows al cerrar la ventana de la consola; SIGBREAK con Ctrl+Pausa
for (const senal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.on(senal, salir);
