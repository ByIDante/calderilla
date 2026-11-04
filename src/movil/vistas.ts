import { html, raw } from "hono/html";
import type { Html, Seccion } from "../servidor/vistas/comun.ts";
import type { EstadoMovil } from "./estado.ts";

export interface EstadoIndicador {
  clave: "guardado" | "subiendo" | "pendiente" | "sin-conexion" | "revisar";
  texto: string;
  /** La explicación larga (al mantener pulsado o con un lector de pantalla). */
  titulo: string;
}

/** Lo que dice el indicador de arriba: si lo apuntado ya está en Drive. */
export function estadoIndicador(estado: EstadoMovil, enLinea: boolean): EstadoIndicador {
  const sync = estado.sync;
  if (!sync) return { clave: "pendiente", texto: "Sin carpeta", titulo: "Aún no has elegido la carpeta de Drive" };
  if (sync.estado.tipo === "error") return { clave: "revisar", texto: "Revisar", titulo: `No se puede guardar en Drive: ${sync.estado.mensaje}` };
  if (sync.ocupado) return { clave: "subiendo", texto: "Guardando…", titulo: "Guardando en Drive" };
  const pendiente = sync.estadoLocal().sucio;
  if (!enLinea) return { clave: "sin-conexion", texto: "Sin conexión", titulo: pendiente ? "Lo apuntado está en el móvil y se guardará en Drive al volver la conexión" : "Sin conexión: todo lo apuntado ya estaba en Drive" };
  if (pendiente) return { clave: "pendiente", texto: "Por guardar", titulo: "Lo apuntado está en el móvil y se guarda en Drive en unos segundos" };
  return { clave: "guardado", texto: "Guardado", titulo: "Todo lo apuntado está guardado en Drive" };
}

// Iconos de trazo (toman el color del texto), dibujados en una caja de 24×24
const ICONOS = {
  resumen: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  ocio: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  apuntar: '<path d="M12 5v14M5 12h14"/>',
  movimientos: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  mas: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
};

const icono = (nombre: keyof typeof ICONOS) =>
  raw(`<svg class="icono" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[nombre]}</svg>`);

/** En qué botón de la barra cae cada sección: lo que no tiene botón propio está en «Más». */
function botonDe(seccion: Seccion): keyof typeof ICONOS {
  return seccion === "resumen" || seccion === "ocio" || seccion === "movimientos" || seccion === "apuntar" ? seccion : "mas";
}

/** El indicador de la sincronización y la barra de abajo (van justo después del menú de la página). */
export function barraMovil(seccion: Seccion, estado: EstadoMovil | null, enLinea: boolean): Html {
  if (seccion === "bienvenida" || !estado?.sync) return html``;
  const indicador = estadoIndicador(estado, enLinea);
  const actual = botonDe(seccion);
  const boton = (nombre: keyof typeof ICONOS, ruta: string, texto: string) =>
    html`<a href="${ruta}" class="${nombre === "apuntar" ? "barra-apuntar" : ""}" ${nombre === actual ? raw('aria-current="page"') : ""}>${icono(nombre)}<span>${texto}</span></a>`;
  return html`<a class="estado-sync" href="/mas" data-estado-sync="${indicador.clave}" title="${indicador.titulo}" aria-label="${indicador.titulo}"
      ><span class="estado-sync-punto" aria-hidden="true"></span><span data-estado-sync-texto>${indicador.texto}</span></a
    ><nav class="barra-movil" aria-label="Secciones principales">
      ${boton("resumen", "/", "Resumen")} ${boton("ocio", "/ocio", "Ocio")} ${boton("apuntar", "/apuntar", "Apuntar")}
      ${boton("movimientos", "/movimientos", "Movimientos")} ${boton("mas", "/mas", "Más")}
    </nav>`;
}
