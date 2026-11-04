import type { Hono } from "hono";
import { html } from "hono/html";
import { leerNombre } from "../../datos/copias.ts";
import { render } from "../../servidor/estado.ts";
import { Formulario, redirigir } from "../../servidor/formulario.ts";
import { aviso, campo, type Html } from "../../servidor/vistas/comun.ts";
import { abrirSync, clienteDrive, guardarAjustes, type EstadoMovil } from "../estado.ts";
import { buscarCarpetasCopias, crearCarpetaCopias, SinPermisoDrive, type CarpetaEncontrada } from "../sync/drive.ts";

const esCopia = (nombre: string) => leerNombre(nombre) !== null;

function pasoConectar(motivo: string | null): Html {
  return html`<section class="tarjeta">
    <h2>1 · Conecta tu Google Drive</h2>
    ${motivo ? aviso("atencion", motivo) : ""}
    <p>
      Calderilla guarda tus datos en este móvil y deja una copia en una carpeta de tu Google Drive: la misma que usa Calderilla en tu ordenador, si la
      tienes. No pasan por ningún otro sitio.
    </p>
    <p class="apagado pequeno">
      Google te avisará de que no ha verificado la app (es para tus amigos y para ti, no para el público): pulsa «Configuración avanzada» y luego «Ir a…».
      Si te pregunta a qué puede acceder, marca Google Drive.
    </p>
    <div class="botones"><a class="boton boton-principal" href="/drive/conectar?volver=/bienvenida" hx-boost="false">Conectar con Google Drive</a></div>
  </section>`;
}

function pasoCarpeta(carpetas: CarpetaEncontrada[], nombre: string): Html {
  const opcion = (valor: string, titulo: string, detalle: string, marcada: boolean) => html`<div class="campo-casilla">
    <input type="radio" id="carpeta-${valor}" name="carpeta" value="${valor}" ${marcada ? "checked" : ""} required />
    <label for="carpeta-${valor}"><b>${titulo}</b> <span class="apagado pequeno">${detalle}</span></label>
  </div>`;
  const conCopias = carpetas.filter((c) => c.copias);
  return html`<section class="tarjeta">
    <h2>2 · ¿Dónde están tus copias?</h2>
    <form method="post" action="/bienvenida" class="formulario">
      <fieldset>
        <legend>Carpeta de copias</legend>
        ${conCopias.map((c, i) => opcion(c.id, c.ruta, `${c.copias} copias · la última, del ${fechaCopia(c.ultima!)}`, i === 0))}
        ${opcion("nueva", "No tengo Calderilla en ningún ordenador", "Crea «Calderilla/copias» en tu Drive y empiezas de cero", conCopias.length === 0)}
      </fieldset>
      ${campo({ etiqueta: "Nombre de este móvil", nombre: "nombre", valor: nombre, requerido: true, ayuda: "Sale en las copias y al resolver un conflicto, para saber de dónde vienen." })}
      <div class="botones"><button class="boton boton-principal" type="submit">Empezar</button></div>
    </form>
  </section>`;
}

/** «000078-20261103220948-…» → «03/11/2026». */
function fechaCopia(archivo: string): string {
  const marca = leerNombre(archivo)?.marca ?? "";
  return `${marca.slice(6, 8)}/${marca.slice(4, 6)}/${marca.slice(0, 4)}`;
}

/** La primera vez: conectar Drive, elegir la carpeta de copias y ponerle nombre al móvil. */
export function rutasBienvenida(app: Hono, estado: EstadoMovil) {
  app.get("/bienvenida", async (c) => {
    if (estado.sync) return c.redirect("/", 303);
    let contenido: Html;
    if (!estado.permiso || estado.permiso.caduca <= estado.ahora()) {
      contenido = pasoConectar(null);
    } else {
      try {
        contenido = pasoCarpeta(await buscarCarpetasCopias(clienteDrive(estado), esCopia), estado.ajustes.equipoNombre);
      } catch (error) {
        contenido = error instanceof SinPermisoDrive ? pasoConectar(error.message) : aviso("error", `No se ha podido mirar tu Drive: ${(error as Error).message}`);
      }
    }
    return render(c, estado, { titulo: "Bienvenido a Calderilla", seccion: "bienvenida" }, contenido);
  });

  app.post("/bienvenida", async (c) => {
    if (estado.sync) return c.redirect("/", 303);
    const f = await Formulario.de(c);
    const nombre = f.texto("nombre");
    const elegida = f.texto("carpeta");
    if (!nombre || !elegida) return redirigir(c, "/bienvenida", { error: "Elige la carpeta y ponle nombre al móvil." });
    try {
      const cliente = clienteDrive(estado);
      // Solo vale una carpeta de las que se han enseñado (o una nueva)
      const carpeta = elegida === "nueva" ? { id: await crearCarpetaCopias(cliente), ruta: "Calderilla/copias" } : (await buscarCarpetasCopias(cliente, esCopia)).find((c) => c.id === elegida);
      if (!carpeta) return redirigir(c, "/bienvenida", { error: "Esa carpeta ya no está en tu Drive." });
      Object.assign(estado.ajustes, { carpetaId: carpeta.id, carpetaRuta: carpeta.ruta, equipoNombre: nombre });
      await guardarAjustes(estado);
      estado.sync = abrirSync(estado, null);
      const decision = await estado.sync.comprobar();
      if (estado.sync.estado.tipo === "error") return redirigir(c, "/ajustes", { error: `No se ha podido usar la carpeta: ${estado.sync.estado.mensaje}` });
      return decision?.tipo === "descargar"
        ? redirigir(c, "/", { ok: `Datos cargados desde «${carpeta.ruta}».` })
        : redirigir(c, "/ajustes", { ok: "¡Listo! Empieza por tu perfil: cambia las recomendaciones." });
    } catch (error) {
      return redirigir(c, "/bienvenida", { error: (error as Error).message });
    }
  });
}
