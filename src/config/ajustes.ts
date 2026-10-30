import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Ajustes de ESTE ordenador. No van en el repo ni en la carpeta sincronizada: cada ordenador tiene su
 * carpeta de datos, su nombre y sus claves (CoinGecko, Enable Banking…).
 */
export interface Ajustes {
  /** Carpeta sincronizada (Drive, Dropbox, Syncthing…) donde se guardan las copias. */
  carpetaDatos: string | null;
  equipoId: string;
  equipoNombre: string;
  puerto: number;
  abrirNavegador: boolean;
  coingeckoClave: string | null;
}

export const PUERTO_POR_DEFECTO = 5180;

export function carpetaAjustes(): string {
  if (process.env.CALDERILLA_CONFIG_DIR) return path.resolve(process.env.CALDERILLA_CONFIG_DIR);
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "calderilla");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "calderilla");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "calderilla");
}

const archivoAjustes = () => path.join(carpetaAjustes(), "config.json");

function nuevoEquipoId(): string {
  // 8 caracteres en minúscula: van en el nombre de cada copia y deben ser válidos en Windows
  return randomBytes(5).toString("hex").slice(0, 8);
}

export function cargarAjustes(): Ajustes {
  mkdirSync(carpetaAjustes(), { recursive: true });
  let guardados: Partial<Ajustes> = {};
  if (existsSync(archivoAjustes())) {
    guardados = JSON.parse(readFileSync(archivoAjustes(), "utf8")) as Partial<Ajustes>;
  }
  const ajustes: Ajustes = {
    carpetaDatos: guardados.carpetaDatos ?? null,
    equipoId: guardados.equipoId && /^[a-z0-9]{8}$/.test(guardados.equipoId) ? guardados.equipoId : nuevoEquipoId(),
    equipoNombre: guardados.equipoNombre || os.hostname(),
    puerto: Number(process.env.CALDERILLA_PUERTO) || guardados.puerto || PUERTO_POR_DEFECTO,
    abrirNavegador: process.env.CALDERILLA_SIN_NAVEGADOR ? false : (guardados.abrirNavegador ?? true),
    coingeckoClave: guardados.coingeckoClave ?? null,
  };
  if (JSON.stringify(guardados) !== JSON.stringify(ajustes)) guardarAjustes(ajustes);
  return ajustes;
}

export function guardarAjustes(ajustes: Ajustes) {
  mkdirSync(carpetaAjustes(), { recursive: true });
  const temporal = `${archivoAjustes()}.tmp`;
  writeFileSync(temporal, `${JSON.stringify(ajustes, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporal, archivoAjustes());
}

export function rutaTrabajo(): string {
  return path.join(carpetaAjustes(), "trabajo.db");
}

/** Carpetas sincronizadas habituales que existen en este ordenador, para sugerirlas en el asistente. */
export function carpetasSugeridas(): string[] {
  const casa = os.homedir();
  const candidatas = [
    path.join(casa, "Google Drive", "Mi unidad"),
    path.join(casa, "Google Drive", "My Drive"),
    path.join(casa, "Google Drive"),
    path.join(casa, "Dropbox"),
    path.join(casa, "OneDrive"),
    path.join(casa, "Sync"),
    path.join(casa, "Syncthing"),
  ];
  if (process.platform === "win32") {
    for (const unidad of ["G", "H", "I"]) candidatas.unshift(`${unidad}:\\Mi unidad`, `${unidad}:\\My Drive`);
  }
  return candidatas.filter((carpeta) => existsSync(carpeta)).map((carpeta) => path.join(carpeta, "Calderilla"));
}
