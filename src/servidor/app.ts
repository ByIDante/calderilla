import { readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { html } from "hono/html";
import type { Ajustes } from "../config/ajustes.ts";
import type { Sincronizador } from "../datos/sync.ts";
import { diasParaCaducar, leerBancos } from "../bancos/conexiones.ts";
import { render, type Estado as EstadoComun } from "./estado.ts";
import { montar } from "./montar.ts";
import { rutasBancos } from "./rutas/bancos.ts";
import { rutasCarpeta, tarjetasEquipo } from "./rutas/carpeta.ts";
import { seguridad } from "./seguridad.ts";
import { aviso, botonAccion, pagina, type Banda } from "./vistas/comun.ts";

/** El estado de la app en el PC: lo común (estado.ts) más la carpeta de datos, el token y el cierre. */
export interface Estado extends EstadoComun {
  ajustes: Ajustes;
  sync: Sincronizador | null;
  token: string;
  /** Cambia la carpeta de datos de este ordenador y abre (o crea) los datos que haya en ella. */
  usarCarpeta: (carpeta: string) => void;
  guardarAjustes: (ajustes: Ajustes) => void;
  /** Cierra el programa guardando lo pendiente (botón «Cerrar Calderilla»: sin ventana no hay otra forma). */
  salir?: () => void;
  /** Cierra y vuelve a abrir el programa (tras instalar una versión nueva). */
  reiniciar?: () => void;
}

/** Los permisos de los bancos que caducan pronto: solo el PC se conecta a los bancos. */
function bandasBancos(): Banda[] {
  const lista: Banda[] = [];
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
  return lista;
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
  estado.bandasPlataforma = bandasBancos;
  app.use(seguridad(estado.ajustes.puerto, estado.token));

  app.get("/estatico/:archivo", (c) => {
    const estatico = ESTATICOS[c.req.param("archivo")];
    if (!estatico) return c.notFound();
    return c.body(readFileSync(rutaEstatico(estatico.archivo)), 200, { "Content-Type": estatico.tipo, "Cache-Control": "no-cache" });
  });

  montar(app, estado, { tarjetasEquipo: () => tarjetasEquipo(estado) });
  rutasCarpeta(app, estado);
  rutasBancos(app, estado);

  app.get("/reiniciar", (c) =>
    render(
      c,
      estado,
      { titulo: "Reiniciar Calderilla", seccion: "ajustes" },
      html`<section class="tarjeta">
        <p>
          ${estado.versionNueva === "disponible"
            ? "Hay una versión nueva. Para instalarla hay que cerrar Calderilla y volver a abrirla: se guarda todo antes, se descarga y tarda unos segundos."
            : "Se ha instalado una versión nueva. Para usarla hay que cerrar Calderilla y volver a abrirla: se guarda todo antes y tarda unos segundos."}
        </p>
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
        // app.js recarga en cuanto la app vuelve a responder; el refresh es por si no hubiera JavaScript
        html`<meta http-equiv="refresh" content="120;url=/" />
          <div data-esperar-vuelta>${aviso("info", "Reiniciando Calderilla con la versión nueva. Esta página se recargará sola en unos segundos.")}</div>`,
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
