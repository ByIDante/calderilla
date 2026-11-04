import type { Context } from "hono";
import type { Sincronia } from "../datos/copias.ts";
import type { BaseDatos } from "../datos/db.ts";
import type { Fecha } from "../dominio/fechas.ts";
import { pagina, type Banda, type Html, type OpcionesPagina } from "./vistas/comun.ts";

/** Lo que las pantallas comunes saben de este equipo: el PC y el móvil guardan cada uno sus propios ajustes. */
export interface AjustesEquipo {
  equipoId: string;
  equipoNombre: string;
  coingeckoClave: string | null;
}

/** El estado que comparten el PC y el móvil. El del PC, con lo suyo (carpeta, token, cerrar…), está en app.ts. */
export interface Estado {
  ajustes: AjustesEquipo;
  sync: Sincronia | null;
  hoy: () => Fecha;
  /** Error al abrir los datos (p. ej. los guardó una versión más nueva del programa). */
  errorFatal: string | null;
  /**
   * «instalada»: se ha instalado una versión nueva mientras la app estaba abierta.
   * «disponible»: se ha visto una versión nueva, que se instala al reiniciar.
   */
  versionNueva?: "instalada" | "disponible";
  /** Avisos de la banda superior que solo tiene una plataforma (en el PC, los permisos de los bancos). */
  bandasPlataforma?: () => Banda[];
}

/** La base de datos de esta petición (solo existe con una carpeta de datos elegida). */
export function bd(estado: Estado): BaseDatos {
  if (!estado.sync) throw new Error("Aún no has elegido la carpeta de datos.");
  return estado.sync.bd;
}

/** Avisos de la banda superior: cambios llegados de otro ordenador, errores de la carpeta… */
export function bandas(estado: Estado): Banda[] {
  const lista: Banda[] = [];
  if (estado.versionNueva === "instalada") lista.push({ nivel: "info", texto: "Hay una versión nueva de Calderilla instalada.", enlace: { ruta: "/reiniciar", texto: "Reiniciar para usarla" } });
  if (estado.versionNueva === "disponible") lista.push({ nivel: "info", texto: "Hay una versión nueva de Calderilla.", enlace: { ruta: "/reiniciar", texto: "Reiniciar para instalarla" } });
  const sync = estado.sync;
  if (!sync) return lista;
  if (sync.aviso) {
    lista.push({ nivel: "info", texto: sync.aviso });
    sync.aviso = null;
  }
  lista.push(...(estado.bandasPlataforma?.() ?? []));
  if (sync.estado.tipo === "error") {
    lista.push({ nivel: "error", texto: `No se puede usar la carpeta de datos: ${sync.estado.mensaje}`, enlace: { ruta: "/ajustes", texto: "Revisar en Ajustes" } });
  }
  return lista;
}

/** Pinta una página con los avisos de la banda y el mensaje de ?ok= / ?error=. */
export function render(c: Context, estado: Estado, op: Omit<OpcionesPagina, "bandas" | "ok" | "error">, contenido: Html) {
  return c.html(pagina({ ...op, bandas: bandas(estado), ok: c.req.query("ok") ?? null, error: c.req.query("error") ?? null }, contenido));
}
