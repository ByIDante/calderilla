// Crea una app de pruebas con su propia carpeta temporal, para los tests que recorren pantallas.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Ajustes } from "../src/config/ajustes.ts";
import { Sincronizador } from "../src/datos/sync.ts";
import { crearApp, type Estado } from "../src/servidor/app.ts";
import { prepararBase } from "../src/servicios/semillas.ts";

export function appDePrueba(puerto: number, hoy = "2026-10-30") {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-app-"));
  process.env.CALDERILLA_CONFIG_DIR = carpeta;
  const ajustes: Ajustes = { carpetaDatos: path.join(carpeta, "datos"), equipoId: "aaaaaaaa", equipoNombre: "Pruebas", puerto, abrirNavegador: false, coingeckoClave: null };
  const estado: Estado = { ajustes, sync: null, token: "t", hoy: () => hoy, errorFatal: null, usarCarpeta: () => {}, guardarAjustes: () => {} };
  estado.sync = new Sincronizador({ carpetaDatos: ajustes.carpetaDatos!, rutaTrabajo: path.join(carpeta, "trabajo.db"), equipoId: "aaaaaaaa", equipoNombre: "Pruebas", alAbrir: prepararBase });
  const app = crearApp(estado);
  const pedir = (ruta: string, cuerpo?: Record<string, string>) =>
    app.request(`http://127.0.0.1:${puerto}${ruta}`, {
      method: cuerpo ? "POST" : "GET",
      headers: { host: `127.0.0.1:${puerto}`, cookie: "calderilla=t", ...(cuerpo ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: cuerpo ? new URLSearchParams(cuerpo).toString() : undefined,
    });
  // Formularios con archivos (multipart): el navegador pone él mismo el content-type
  const enviarArchivo = (ruta: string, formulario: FormData) =>
    app.request(`http://127.0.0.1:${puerto}${ruta}`, { method: "POST", headers: { host: `127.0.0.1:${puerto}`, cookie: "calderilla=t" }, body: formulario });
  return { estado, bd: estado.sync.bd, pedir, enviarArchivo, carpeta };
}
