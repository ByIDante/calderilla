import type { Hono } from "hono";
import { html } from "hono/html";
import { pagina } from "../../servidor/vistas/comun.ts";
import type { EstadoMovil } from "../estado.ts";
import { leerVuelta, urlDeAcceso } from "../google.ts";

interface PeticionOauth {
  estado: string;
  /** Adónde volver después (la página desde la que se pidió). */
  volver: string;
}

/** Solo direcciones de la propia app: «volver» llega en la dirección y no puede llevar a otra web. */
const volverSeguro = (volver: string | undefined) => (volver?.startsWith("/") && !volver.startsWith("//") ? volver : null);

/**
 * Conectar con Google Drive. Va antes de la puerta de la app: se usa antes de elegir la carpeta y cuando el
 * permiso ha caducado.
 */
export function rutasGoogle(app: Hono, estado: EstadoMovil) {
  // Un enlace, no un formulario: la política de seguridad no deja que un formulario acabe en otra web
  app.get("/drive/conectar", async (c) => {
    const peticion: PeticionOauth = { estado: crypto.randomUUID(), volver: volverSeguro(c.req.query("volver")) ?? (estado.sync ? "/" : "/bienvenida") };
    await estado.almacen.guardar("oauth", peticion);
    return c.redirect(urlDeAcceso(estado.origen, peticion.estado, c.req.query("silencioso") === "1"), 302);
  });

  // Google vuelve aquí con el permiso detrás de «#», que solo ve la página: ella se lo pasa a /drive/token
  app.get("/drive/vuelta", (c) =>
    c.html(
      pagina(
        { titulo: "Conectando con Google Drive", seccion: "bienvenida" },
        html`<div data-vuelta-google><p>Un momento…</p></div>
          <noscript><p>Para conectar con Google hace falta JavaScript.</p></noscript>`,
      ),
    ),
  );

  app.post("/drive/token", async (c) => {
    const peticion = await estado.almacen.leer<PeticionOauth>("oauth");
    const resultado = leerVuelta(await c.req.json<Record<string, string>>(), peticion?.estado, estado.ahora());
    await estado.almacen.borrar("oauth");
    const volver = peticion?.volver ?? "/";
    if ("error" in resultado) {
      // Si renovar sin preguntar no ha podido, se sigue en la página y la banda avisa de volver a conectar
      if (resultado.silencioso) estado.renovacionFallida = true;
      return c.json({ ok: false, error: resultado.error, volver, seguir: Boolean(resultado.silencioso) });
    }
    estado.renovacionFallida = false;
    estado.permiso = resultado.permiso;
    await estado.almacen.guardar("permiso", resultado.permiso);
    // Si la sincronización se paró por el permiso, se vuelve a mirar ya
    if (estado.sync?.estado.tipo === "error") void estado.sync.comprobar();
    return c.json({ ok: true, volver });
  });
}
