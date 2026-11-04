import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { hoy as hoyLocal } from "../dominio/fechas.ts";
import type { AjustesEquipo, Estado } from "../servidor/estado.ts";
import { prepararBase } from "../servicios/semillas.ts";
import type { Almacen } from "./almacen.ts";
import type { PermisoGoogle } from "./google.ts";
import { CarpetaDrive, ClienteDrive, SinPermisoDrive } from "./sync/drive.ts";
import { SincronizadorMovil } from "./sync/sincronizador.ts";

/** Los ajustes de este móvil (se guardan solo en él, como los de cada PC). */
export interface AjustesMovil extends AjustesEquipo {
  /** La carpeta «copias» de Drive que usa, y cómo se llama, para enseñarla. */
  carpetaId: string | null;
  carpetaRuta: string | null;
}

/** El estado de la app en el móvil: lo común (servidor/estado.ts) más Drive, el almacén y el permiso de Google. */
export interface EstadoMovil extends Estado {
  ajustes: AjustesMovil;
  sync: SincronizadorMovil | null;
  almacen: Almacen;
  sqlite3: Sqlite3Static;
  permiso: PermisoGoogle | null;
  /** fetch: en los tests, el de un Drive falso. */
  pedir: typeof fetch;
  /** La dirección de la app («https://calderilla-app.pages.dev»). */
  origen: string;
  ahora: () => number;
  /** Renovar el permiso sin preguntar no ha funcionado: hasta que se conecte a mano, no se vuelve a intentar. */
  renovacionFallida?: boolean;
  /** Pasa a la versión nueva que espera instalada (la pone el service worker). */
  activarVersion?: () => void;
  /** La versión de la app que está respondiendo. */
  version?: string;
  /** Cuando cambia el estado de la sincronización (el service worker se lo cuenta a las páginas abiertas). */
  alCambiarSync?: () => void;
}

export interface Dependencias {
  almacen: Almacen;
  sqlite3: Sqlite3Static;
  origen: string;
  pedir?: typeof fetch;
  hoy?: () => string;
  ahora?: () => number;
}

/** Un identificador nuevo para este móvil, como el de cada PC: 8 letras y números. */
function nuevoEquipoId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ajustesNuevos(): AjustesMovil {
  return { equipoId: nuevoEquipoId(), equipoNombre: "Mi móvil", coingeckoClave: null, carpetaId: null, carpetaRuta: null };
}

/** Abre lo guardado en el móvil: los ajustes, el permiso de Google y, si ya se eligió la carpeta, la base. */
export async function arrancar(dependencias: Dependencias): Promise<EstadoMovil> {
  const { almacen } = dependencias;
  const estado: EstadoMovil = {
    ajustes: (await almacen.leer<AjustesMovil>("ajustes")) ?? ajustesNuevos(),
    sync: null,
    almacen,
    sqlite3: dependencias.sqlite3,
    permiso: (await almacen.leer<PermisoGoogle>("permiso")) ?? null,
    pedir: dependencias.pedir ?? ((...args) => fetch(...args)),
    origen: dependencias.origen,
    hoy: dependencias.hoy ?? hoyLocal,
    ahora: dependencias.ahora ?? Date.now,
    errorFatal: null,
  };
  if (estado.ajustes.carpetaId) {
    try {
      estado.sync = abrirSync(estado, (await almacen.leer<Uint8Array>("base")) ?? null);
    } catch (error) {
      estado.errorFatal = (error as Error).message;
    }
  }
  return estado;
}

/** El cliente de Drive con el permiso de ahora: si ha caducado, lo dice para volver a conectar. */
export function clienteDrive(estado: EstadoMovil): ClienteDrive {
  return new ClienteDrive(async () => {
    if (!estado.permiso || estado.permiso.caduca <= estado.ahora()) throw new SinPermisoDrive();
    return estado.permiso.token;
  }, estado.pedir);
}

export function abrirSync(estado: EstadoMovil, guardada: Uint8Array | null): SincronizadorMovil {
  return SincronizadorMovil.abrir(
    {
      carpeta: new CarpetaDrive(clienteDrive(estado), estado.ajustes.carpetaId!),
      sqlite3: estado.sqlite3,
      equipoId: estado.ajustes.equipoId,
      equipoNombre: estado.ajustes.equipoNombre,
      alAbrir: prepararBase,
      guardarLocal: (bytes) => estado.almacen.guardar("base", bytes),
      alCambiar: () => estado.alCambiarSync?.(),
      ahora: () => new Date(estado.ahora()),
    },
    guardada,
  );
}

export async function guardarAjustes(estado: EstadoMovil) {
  await estado.almacen.guardar("ajustes", estado.ajustes);
}
