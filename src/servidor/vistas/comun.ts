import { createHash } from "node:crypto";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { euros, eurosRedondos, importeEditable, porcentaje } from "../../dominio/dinero.ts";
import type { Aviso } from "../../reglas/tipos.ts";

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export const SECCIONES = [
  { ruta: "/", id: "resumen", nombre: "Resumen" },
  { ruta: "/gastos", id: "gastos", nombre: "Ingresos y gastos" },
  { ruta: "/ocio", id: "ocio", nombre: "Ocio" },
  { ruta: "/movimientos", id: "movimientos", nombre: "Movimientos" },
  { ruta: "/cuentas", id: "cuentas", nombre: "Cuentas y cierres" },
  { ruta: "/inversiones", id: "inversiones", nombre: "Inversiones" },
  { ruta: "/metas", id: "metas", nombre: "Metas" },
  { ruta: "/ajustes", id: "ajustes", nombre: "Ajustes" },
] as const;

export type Seccion = (typeof SECCIONES)[number]["id"] | "bienvenida";

export interface Banda {
  nivel: Aviso["nivel"] | "error";
  texto: string;
  enlace?: { ruta: string; texto: string };
}

export interface OpcionesPagina {
  titulo: string;
  seccion: Seccion;
  bandas?: Banda[];
  /** Mensaje tras guardar (viene en ?ok=… o ?error=…). */
  ok?: string | null;
  error?: string | null;
}

const LOGO = raw(`<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><circle cx="13" cy="18" r="10" class="moneda-a"/><circle cx="19" cy="13" r="10" class="moneda-b"/><text x="19" y="17.5" text-anchor="middle">€</text></svg>`);

const ICONO: Record<Banda["nivel"], string> = { logro: "✓", info: "i", atencion: "!", error: "×" };
const ETIQUETA: Record<Banda["nivel"], string> = { logro: "Bien", info: "Aviso", atencion: "Atención", error: "Error" };

/** Identificador de un aviso a partir de su texto: si la situación cambia, el texto cambia y el aviso vuelve. */
export function claveAviso(texto: string): string {
  return createHash("sha1").update(texto).digest("hex").slice(0, 16);
}

/**
 * Un aviso con su ✕. `cerrar: "local"` solo lo esconde hasta recargar (mensajes tras guardar, errores);
 * con `{ clave }` se recuerda cerrado en los datos y no vuelve a salir en ningún ordenador.
 */
export function aviso(nivel: Banda["nivel"], contenido: string | Html, enlace?: Banda["enlace"], cerrar: "local" | { clave: string } = "local"): Html {
  const boton =
    cerrar === "local"
      ? html`<button type="button" class="aviso-cerrar" data-cerrar-aviso aria-label="Cerrar aviso">✕</button>`
      : html`<form method="post" action="/avisos/ocultar" class="aviso-cerrar-formulario">
          <input type="hidden" name="clave" value="${cerrar.clave}" />
          <button type="submit" class="aviso-cerrar" aria-label="Cerrar aviso" title="No volver a mostrar">✕</button>
        </form>`;
  return html`<div class="aviso aviso-${nivel}" role="${nivel === "error" ? "alert" : "status"}">
    <span class="aviso-icono" aria-hidden="true">${ICONO[nivel]}</span><span class="sr">${ETIQUETA[nivel]}:</span>
    <div>${contenido}${enlace ? html` <a href="${enlace.ruta}">${enlace.texto}</a>` : ""}</div>
    ${boton}
  </div>`;
}

export function pagina(op: OpcionesPagina, contenido: Html): Html {
  return html`<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${op.titulo} · Calderilla</title>
        <link rel="icon" href="/estatico/icono.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/estatico/estilos.css" />
        <script src="/estatico/htmx.min.js" defer></script>
        <script src="/estatico/chart.umd.min.js" defer></script>
        <script src="/estatico/app.js" defer></script>
      </head>
      <body hx-boost="true">
        <a class="saltar" href="#contenido">Ir al contenido</a>
        <div class="marco">
          <nav class="menu" aria-label="Secciones">
            <a class="marca" href="/">${LOGO}<span>Calderilla</span></a>
            ${op.seccion === "bienvenida"
              ? ""
              : html`<ul>
                  ${SECCIONES.map((s) => html`<li><a href="${s.ruta}" ${s.id === op.seccion ? raw('aria-current="page"') : ""}>${s.nombre}</a></li>`)}
                </ul>`}
          </nav>
          <main id="contenido">
            ${(op.bandas ?? []).map((b) => aviso(b.nivel, b.texto, b.enlace))} ${op.ok ? aviso("logro", op.ok) : ""} ${op.error ? aviso("error", op.error) : ""}
            <h1>${op.titulo}</h1>
            ${contenido}
            <footer class="pie">
              Herramienta informativa: no es asesoramiento financiero personalizado ni regulado por la CNMV. Las reglas sugieren; comprueba condiciones y fiscalidad
              antes de decidir.
            </footer>
          </main>
        </div>
      </body>
    </html>`;
}

// ── Piezas reutilizables ───────────────────────────────────────────────────────────────────────────────

export function cifra(etiqueta: string, valor: string, nota?: string | Html, tono?: "bien" | "mal" | "acento"): Html {
  return html`<div class="cifra ${tono ? `cifra-${tono}` : ""}">
    <div class="cifra-etiqueta">${etiqueta}</div>
    <div class="cifra-valor">${valor}</div>
    ${nota ? html`<div class="cifra-nota">${nota}</div>` : ""}
  </div>`;
}

export function porque(texto: string): Html {
  return html`<details class="porque"><summary>¿Por qué?</summary><p>${texto}</p></details>`;
}

/** `limite: true` la pinta en rojo al pasarse (presupuestos); si no, es progreso hacia un objetivo. */
export function barra(actual: number, objetivo: number, etiqueta: string, opciones: { limite?: boolean } = {}): Html {
  const pct = objetivo > 0 ? Math.max(0, Math.min(100, (actual / objetivo) * 100)) : 0;
  const pasada = opciones.limite && actual > objetivo;
  return html`<div class="barra" role="progressbar" aria-label="${etiqueta}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
    <div class="barra-relleno ${pasada ? "barra-pasada" : opciones.limite ? "barra-limite" : ""}" style="width: ${pct.toFixed(1)}%"></div>
  </div>`;
}

export const eur = euros;
export const eurR = eurosRedondos;
export const pct = porcentaje;

export function importeOVacio(c: number | null | undefined): string {
  return importeEditable(c);
}

export function vacio(texto: string, accion?: Html): Html {
  return html`<div class="vacio"><p>${texto}</p>${accion ?? ""}</div>`;
}

// ── Formularios ────────────────────────────────────────────────────────────────────────────────────────

interface Campo {
  etiqueta: string;
  nombre: string;
  valor?: string | number | null;
  tipo?: "text" | "date" | "number" | "month" | "password";
  ayuda?: string;
  requerido?: boolean;
  /** Para importes y porcentajes: teclado numérico y sufijo. */
  sufijo?: string;
  marcador?: string;
  id?: string;
}

export function campo(c: Campo): Html {
  const id = c.id ?? `campo-${c.nombre}`;
  const numerico = c.sufijo !== undefined;
  return html`<div class="campo">
    <label for="${id}">${c.etiqueta}</label>
    <div class="entrada ${c.sufijo ? "con-sufijo" : ""}">
      <input
        id="${id}"
        name="${c.nombre}"
        type="${c.tipo ?? "text"}"
        value="${c.valor ?? ""}"
        ${c.requerido ? raw("required") : ""}
        ${numerico ? raw('inputmode="decimal" autocomplete="off"') : ""}
        ${c.marcador ? html`placeholder="${c.marcador}"` : ""}
        ${c.ayuda ? html`aria-describedby="${id}-ayuda"` : ""}
      />
      ${c.sufijo ? html`<span class="sufijo">${c.sufijo}</span>` : ""}
    </div>
    ${c.ayuda ? html`<p class="ayuda" id="${id}-ayuda">${c.ayuda}</p>` : ""}
  </div>`;
}

export function selector(etiqueta: string, nombre: string, opciones: readonly (readonly [string, string])[], valor: string | null | undefined, ayuda?: string): Html {
  const id = `campo-${nombre}`;
  return html`<div class="campo">
    <label for="${id}">${etiqueta}</label>
    <select id="${id}" name="${nombre}">
      ${opciones.map(([v, texto]) => html`<option value="${v}" ${v === (valor ?? "") ? raw("selected") : ""}>${texto}</option>`)}
    </select>
    ${ayuda ? html`<p class="ayuda">${ayuda}</p>` : ""}
  </div>`;
}

export function casilla(etiqueta: string, nombre: string, marcada: boolean, ayuda?: string, id?: string): Html {
  const idCampo = id ?? `campo-${nombre}`;
  return html`<div class="campo campo-casilla">
    <input type="checkbox" id="${idCampo}" name="${nombre}" value="1" ${marcada ? raw("checked") : ""} />
    <label for="${idCampo}">${etiqueta}</label>
    ${ayuda ? html`<p class="ayuda">${ayuda}</p>` : ""}
  </div>`;
}

/** Botón que envía un POST pequeño (borrar, archivar…) con confirmación opcional. */
/**
 * Botón que envía un POST pequeño (borrar, archivar…) con confirmación opcional. `mantenerPosicion` hace que,
 * al volver a la misma página, no salte arriba del todo.
 */
export function botonAccion(
  ruta: string,
  texto: string,
  opciones: { confirmar?: string; estilo?: "peligro" | "secundario" | "enlace"; campos?: Record<string, string>; pequeno?: boolean; mantenerPosicion?: boolean } = {},
): Html {
  return html`<form method="post" action="${ruta}" class="en-linea" ${opciones.confirmar ? html`hx-confirm="${opciones.confirmar}"` : ""} ${opciones.mantenerPosicion ? html`data-mantener-posicion` : ""}>
    ${Object.entries(opciones.campos ?? {}).map(([nombre, valor]) => html`<input type="hidden" name="${nombre}" value="${valor}" />`)}
    <button type="submit" class="boton boton-${opciones.estilo ?? "secundario"} ${opciones.pequeno ? "boton-pequeno" : ""}">${texto}</button>
  </form>`;
}

/** Datos para un gráfico de Chart.js: los lee estatico/app.js. */
export function grafico(id: string, titulo: string, datos: unknown, tabla: Html): Html {
  return html`<figure class="grafico">
    <figcaption>${titulo}</figcaption>
    <div class="grafico-lienzo"><canvas id="${id}" data-grafico="${id}-datos" role="img" aria-label="${titulo}"></canvas></div>
    <script type="application/json" id="${id}-datos">
      ${raw(JSON.stringify(datos).replace(/</g, "\\u003c"))}
    </script>
    <details class="como-tabla"><summary>Ver como tabla</summary>${tabla}</details>
  </figure>`;
}
