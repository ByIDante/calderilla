import type { Hono } from "hono";
import type { Estado } from "./estado.ts";
import { rutasAjustes } from "./rutas/ajustes.ts";
import { rutasCalculadora } from "./rutas/calculadora.ts";
import { rutasCopias } from "./rutas/copias.ts";
import { rutasCuentas } from "./rutas/cuentas.ts";
import { rutasGastos } from "./rutas/gastos.ts";
import { rutasImportar } from "./rutas/importar.ts";
import { rutasInversiones } from "./rutas/inversiones.ts";
import { rutasMetas } from "./rutas/metas.ts";
import { rutasMovimientos } from "./rutas/movimientos.ts";
import { rutasOcio } from "./rutas/ocio.ts";
import { rutasResumen } from "./rutas/resumen.ts";
import { aviso, pagina, type Html } from "./vistas/comun.ts";

export interface OpcionesMontar {
  /** Las tarjetas de Ajustes propias de la plataforma («Este ordenador» en el PC). */
  tarjetasEquipo: () => Html;
}

/** La puerta de entrada y las pantallas que comparten el PC y el móvil, en el orden en que se registran. */
export function montar(app: Hono, estado: Estado, opciones: OpcionesMontar) {
  // Sin carpeta de datos solo se puede ir al asistente; con un conflicto pendiente, solo a resolverlo
  app.use(async (c, next) => {
    const ruta = c.req.path;
    if (estado.errorFatal) {
      return c.html(pagina({ titulo: "No se pueden abrir tus datos", seccion: "bienvenida" }, aviso("error", estado.errorFatal)), 500);
    }
    if (!estado.sync && !ruta.startsWith("/bienvenida")) return c.redirect("/bienvenida", 303);
    // Con un conflicto pendiente se mira siempre: puede que ya se haya resuelto en el otro ordenador
    if (c.req.method === "GET") await estado.sync?.comprobarSiToca(estado.sync.estado.tipo === "conflicto" ? 0 : 10_000);
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
  rutasCalculadora(app, estado);
  rutasAjustes(app, estado, opciones.tarjetasEquipo);
  rutasCopias(app, estado);
}
