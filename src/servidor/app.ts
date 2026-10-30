import { readFileSync } from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import type { Ajustes } from "../config/ajustes.ts";
import type { BaseDatos } from "../datos/db.ts";
import type { Sincronizador } from "../datos/sync.ts";
import type { Fecha } from "../dominio/fechas.ts";
import { diasParaCaducar, leerBancos } from "../bancos/conexiones.ts";
import { rutasAjustes } from "./rutas/ajustes.ts";
import { rutasBancos } from "./rutas/bancos.ts";
import { rutasCuentas } from "./rutas/cuentas.ts";
import { rutasGastos } from "./rutas/gastos.ts";
import { rutasImportar } from "./rutas/importar.ts";
import { rutasInversiones } from "./rutas/inversiones.ts";
import { rutasMetas } from "./rutas/metas.ts";
import { rutasMovimientos } from "./rutas/movimientos.ts";
import { rutasOcio } from "./rutas/ocio.ts";
import { rutasResumen } from "./rutas/resumen.ts";
import { seguridad } from "./seguridad.ts";
import { html } from "hono/html";
import { aviso, botonAccion, pagina, type Banda, type OpcionesPagina, type Html } from "./vistas/comun.ts";

export interface Estado {
  ajustes: Ajustes;
  sync: Sincronizador | null;
  token: string;
  hoy: () => Fecha;
  /** Error al abrir los datos (p. ej. los guardó una versión más nueva del programa). */
  errorFatal: string | null;
  /** Cambia la carpeta de datos de este ordenador y abre (o crea) los datos que haya en ella. */
  usarCarpeta: (carpeta: string) => void;
  guardarAjustes: (ajustes: Ajustes) => void;
  /** Cierra el programa guardando lo pendiente (botón «Cerrar Calderilla»: sin ventana no hay otra forma). */
  salir?: () => void;
  /** Cierra y vuelve a abrir el programa (tras instalar una versión nueva). */
  reiniciar?: () => void;
  /** Se ha instalado una versión nueva mientras la app estaba abierta. */
  versionNueva?: boolean;
}

/** La base de datos de esta petición (solo existe con una carpeta de datos elegida). */
export function bd(estado: Estado): BaseDatos {
  if (!estado.sync) throw new Error("Aún no has elegido la carpeta de datos.");
  return estado.sync.bd;
}

/** Avisos de la banda superior: cambios llegados de otro ordenador, errores de la carpeta… */
export function bandas(estado: Estado): Banda[] {
  const lista: Banda[] = [];
  if (estado.versionNueva) lista.push({ nivel: "info", texto: "Hay una versión nueva de Calderilla instalada.", enlace: { ruta: "/reiniciar", texto: "Reiniciar para usarla" } });
  const sync = estado.sync;
  if (!sync) return lista;
  if (sync.aviso) {
    lista.push({ nivel: "info", texto: sync.aviso });
    sync.aviso = null;
  }
  for (const conexion of leerBancos().conexiones) {
    const dias = diasParaCaducar(conexion);
    if (dias <= 14) {
      lista.push({
        nivel: "atencion",
        texto: dias < 0 ? `El permiso de ${conexion.banco} ha caducado.` : `El permiso de ${conexion.banco} caduca en ${dias} días.`,
        enlace: { ruta: "/bancos", texto: "Renovarlo" },
      });
    }
  }
  if (sync.estado.tipo === "error") {
    lista.push({ nivel: "error", texto: `No se puede usar la carpeta de datos: ${sync.estado.mensaje}`, enlace: { ruta: "/ajustes", texto: "Revisar en Ajustes" } });
  }
  return lista;
}

/** Pinta una página con los avisos de la banda y el mensaje de ?ok= / ?error=. */
export function render(c: Context, estado: Estado, op: Omit<OpcionesPagina, "bandas" | "ok" | "error">, contenido: Html) {
  return c.html(pagina({ ...op, bandas: bandas(estado), ok: c.req.query("ok") ?? null, error: c.req.query("error") ?? null }, contenido));
}

const ESTATICOS: Record<string, { archivo: string; tipo: string }> = {
  "estilos.css": { archivo: path.join(import.meta.dirname, "..", "estatico", "estilos.css"), tipo: "text/css; charset=utf-8" },
  "app.js": { archivo: path.join(import.meta.dirname, "..", "estatico", "app.js"), tipo: "text/javascript; charset=utf-8" },
  "icono.svg": { archivo: path.join(import.meta.dirname, "..", "estatico", "icono.svg"), tipo: "image/svg+xml" },
  "htmx.min.js": { archivo: "htmx.org/dist/htmx.min.js", tipo: "text/javascript; charset=utf-8" },
  "chart.umd.min.js": { archivo: "chart.js/dist/chart.umd.min.js", tipo: "text/javascript; charset=utf-8" },
};

function rutaEstatico(archivo: string): string {
  // Las librerías se sirven desde node_modules, sin depender de ningún CDN
  return path.isAbsolute(archivo) ? archivo : path.join(import.meta.dirname, "..", "..", "node_modules", archivo);
}

export function crearApp(estado: Estado): Hono {
  const app = new Hono();
  app.use(seguridad(estado.ajustes.puerto, estado.token));

  app.get("/estatico/:archivo", (c) => {
    const estatico = ESTATICOS[c.req.param("archivo")];
    if (!estatico) return c.notFound();
    return c.body(readFileSync(rutaEstatico(estatico.archivo)), 200, { "Content-Type": estatico.tipo, "Cache-Control": "no-cache" });
  });

  // Sin carpeta de datos solo se puede ir al asistente; con un conflicto pendiente, solo a resolverlo
  app.use(async (c, next) => {
    const ruta = c.req.path;
    if (estado.errorFatal) {
      return c.html(pagina({ titulo: "No se pueden abrir tus datos", seccion: "bienvenida" }, aviso("error", estado.errorFatal)), 500);
    }
    if (!estado.sync && !ruta.startsWith("/bienvenida")) return c.redirect("/bienvenida", 303);
    // Con un conflicto pendiente se mira siempre: puede que ya se haya resuelto en el otro ordenador
    if (c.req.method === "GET") estado.sync?.comprobarSiToca(estado.sync.estado.tipo === "conflicto" ? 0 : 10_000);
    if (estado.sync?.estado.tipo === "conflicto" && !ruta.startsWith("/ajustes/conflicto")) return c.redirect("/ajustes/conflicto", 303);
    await next();
    // Tras cualquier cambio, se guarda una copia en la carpeta sincronizada (unos segundos después)
    if (c.req.method === "POST" && estado.sync) estado.sync.programarEnvio();
  });

  rutasResumen(app, estado);
  rutasGastos(app, estado);
  rutasOcio(app, estado);
  rutasImportar(app, estado);
  rutasMovimientos(app, estado);
  rutasCuentas(app, estado);
  rutasInversiones(app, estado);
  rutasMetas(app, estado);
  rutasAjustes(app, estado);
  rutasBancos(app, estado);

  app.get("/reiniciar", (c) =>
    render(
      c,
      estado,
      { titulo: "Reiniciar Calderilla", seccion: "ajustes" },
      html`<section class="tarjeta">
        <p>Se ha instalado una versión nueva. Para usarla hay que cerrar Calderilla y volver a abrirla: se guarda todo antes y tarda unos segundos.</p>
        ${botonAccion("/reiniciar", "Reiniciar ahora", { estilo: "secundario" })}
      </section>`,
    ),
  );

  app.post("/reiniciar", (c) => {
    setTimeout(() => estado.reiniciar?.(), 300);
    // La página se recarga sola cuando la app ha vuelto
    return c.html(
      pagina(
        { titulo: "Reiniciando…", seccion: "bienvenida" },
        html`<meta http-equiv="refresh" content="4;url=/" />${aviso("info", "Reiniciando Calderilla con la versión nueva. Esta página se recargará sola en unos segundos.")}`,
      ),
    );
  });

  app.post("/salir", (c) => {
    setTimeout(() => estado.salir?.(), 300);
    return c.html(
      pagina(
        { titulo: "Calderilla se ha cerrado", seccion: "bienvenida" },
        aviso("logro", "Tus datos están guardados. Ya puedes cerrar esta pestaña. Para volver a abrirla, usa el acceso directo o «Calderilla.cmd»."),
      ),
    );
  });

  app.onError((error, c) => {
    console.error(error);
    return c.html(pagina({ titulo: "Algo ha fallado", seccion: "resumen" }, aviso("error", error.message || "Error inesperado")), 500);
  });
  app.notFound((c) => c.html(pagina({ titulo: "No encontrado", seccion: "resumen" }, aviso("info", "Esa página no existe.")), 404));
  return app;
}
