import { Hono } from "hono";
import { montar } from "../servidor/montar.ts";
import { aviso, pagina } from "../servidor/vistas/comun.ts";
import type { EstadoMovil } from "./estado.ts";
import { rutasApuntar } from "./rutas/apuntar.ts";
import { rutasBienvenida } from "./rutas/bienvenida.ts";
import { rutasGoogle } from "./rutas/google.ts";
import { rutasMovil, tarjetasEsteMovil } from "./rutas/movil.ts";
import { CABECERAS_SEGURIDAD } from "./seguridad.ts";

/** La app del móvil: las mismas pantallas que el PC (montar) más lo suyo (Google Drive, la bienvenida, «Este móvil»). */
export function crearAppMovil(estado: EstadoMovil): Hono {
  estado.esteEquipo = "Este móvil";
  const app = new Hono();
  app.use(async (c, next) => {
    await next();
    for (const [nombre, valor] of Object.entries(CABECERAS_SEGURIDAD)) c.header(nombre, valor);
  });

  // Antes de la puerta: sirven sin carpeta elegida y con el permiso de Google caducado
  rutasGoogle(app, estado);
  rutasBienvenida(app, estado);
  montar(app, estado, { tarjetasEquipo: () => tarjetasEsteMovil(estado) });
  rutasMovil(app, estado);
  rutasApuntar(app, estado);

  app.onError((error, c) => {
    console.error(error);
    return c.html(pagina({ titulo: "Algo ha fallado", seccion: "resumen" }, aviso("error", error.message || "Error inesperado")), 500);
  });
  app.notFound((c) => c.html(pagina({ titulo: "No encontrado", seccion: "resumen" }, aviso("info", "Esa página no existe.")), 404));
  return app;
}
