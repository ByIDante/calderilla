import type { Hono } from "hono";
import { html } from "hono/html";
import { fechaDeMarca } from "../../datos/copias.ts";
import { render } from "../../servidor/estado.ts";
import { Formulario, redirigir } from "../../servidor/formulario.ts";
import { botonAccion, campo, vacio, type Html } from "../../servidor/vistas/comun.ts";
import { guardarAjustes, type EstadoMovil } from "../estado.ts";

const fecha = (marca: string) => fechaDeMarca(marca).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });

/** Las tarjetas «Este móvil» y «Servicios vinculados» de Ajustes. */
export function tarjetasEsteMovil(estado: EstadoMovil): Html {
  const sync = estado.sync!;
  const local = sync.estadoLocal();
  const base = local.base?.split("-")[1];
  const permiso = estado.permiso && estado.permiso.caduca > estado.ahora() ? estado.permiso : null;
  return html`<section class="tarjeta">
      <h2>Este móvil</h2>
      <ul class="lista-plana">
        <li><span>Nombre</span><span>${estado.ajustes.equipoNombre}</span></li>
        <li><span>Carpeta de Drive</span><span>${estado.ajustes.carpetaRuta ?? "?"}</span></li>
        <li><span>Última copia</span><span>${base ? fecha(base) : "ninguna"}</span></li>
        <li><span>Cambios sin copiar</span><span>${local.sucio ? "sí (se copian en unos segundos)" : "no"}</span></li>
        <li><span>Google Drive</span><span>${permiso ? `conectado hasta las ${new Date(permiso.caduca).toLocaleTimeString("es-ES", { timeStyle: "short" })}` : "sin conectar"}</span></li>
      </ul>
      <div class="botones bloque">
        ${botonAccion("/ajustes/copiar", "Guardar copia ahora")}
        <a class="boton" href="/ajustes/copias">Copias de seguridad</a>
        <a class="boton" href="/drive/conectar?volver=/ajustes" hx-boost="false">${permiso ? "Volver a conectar Drive" : "Conectar Google Drive"}</a>
      </div>
      <details>
        <summary>Cambiar el nombre de este móvil</summary>
        <form method="post" action="/ajustes/movil" class="formulario">
          ${campo({ etiqueta: "Nombre", nombre: "nombre", valor: estado.ajustes.equipoNombre, requerido: true })}
          <div class="botones"><button class="boton" type="submit">Cambiar</button></div>
        </form>
      </details>
    </section>
    <section class="tarjeta">
      <h2>Servicios vinculados</h2>
      <p class="apagado pequeno">Se guardan solo en este móvil. Los bancos se conectan desde el ordenador.</p>
      <form method="post" action="/ajustes/vinculos" class="formulario">
        ${campo({
          etiqueta: "Clave Demo de CoinGecko (opcional)",
          nombre: "coingeckoClave",
          valor: estado.ajustes.coingeckoClave,
          tipo: "password",
          ayuda: "Sin clave funciona, con un límite bajo de consultas. Es gratis: coingecko.com → Developers → Demo API.",
        })}
        <div class="botones"><button class="boton" type="submit">Guardar</button></div>
      </form>
      <ul class="lista-plana bloque">
        <li><a href="/importar">Importar un extracto</a><span class="apagado pequeno">CSV o Excel, cualquier banco</span></li>
      </ul>
    </section>`;
}

/** Lo de Ajustes que solo tiene el móvil: su nombre, su clave de CoinGecko y la lista de copias de Drive. */
export function rutasMovil(app: Hono, estado: EstadoMovil) {
  app.post("/ajustes/movil", async (c) => {
    const nombre = (await Formulario.de(c)).texto("nombre");
    if (!nombre) return redirigir(c, "/ajustes", { error: "Ponle un nombre al móvil." });
    estado.ajustes.equipoNombre = nombre;
    await guardarAjustes(estado);
    estado.sync?.bd.escribirMeta("equipo_nombre", nombre);
    return redirigir(c, "/ajustes", { ok: "Nombre cambiado." });
  });

  app.post("/ajustes/vinculos", async (c) => {
    const clave = (await Formulario.de(c)).opcional("coingeckoClave");
    estado.ajustes.coingeckoClave = clave;
    await guardarAjustes(estado);
    return redirigir(c, "/ajustes", { ok: clave ? "Clave de CoinGecko guardada en este móvil." : "Clave de CoinGecko quitada." });
  });

  // Como en el PC, pero sin abrir cada copia para resumirla: aquí habría que descargarlas todas
  app.get("/ajustes/copias", async (c) => {
    const { copias, rastros } = await estado.sync!.listar();
    const equipo = (id: string) => (id === estado.ajustes.equipoId ? "este móvil" : id);
    const fila = (archivo: string, marca: string, equipoId: string) => html`<tr>
      <td>${fecha(marca)}</td>
      <td>${equipo(equipoId)}</td>
      <td>${botonAccion("/ajustes/copias/restaurar", "Volver a esta", { campos: { archivo }, confirmar: `¿Volver a los datos del ${fecha(marca)}? Lo de ahora queda guardado aparte por si quieres deshacerlo.` })}</td>
    </tr>`;
    const tabla = (filas: Html[]) => html`<div class="tabla-contenedor">
      <table class="tabla-apilable tabla-acciones">
        <thead><tr><th>Guardada</th><th>Equipo</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
    const recientes = [...copias].sort((a, b) => b.marca.localeCompare(a.marca)).slice(0, 40);
    const apartadas = rastros.filter((r) => r.marca && r.archivo.endsWith(".db")).sort((a, b) => b.marca!.localeCompare(a.marca!));
    return render(
      c,
      estado,
      { titulo: "Copias de seguridad", seccion: "ajustes" },
      html`
        <p><a href="/ajustes">← Ajustes</a></p>
        <p class="apagado">
          Calderilla guarda una copia en tu Drive cada vez que cambias algo: todas las de la última semana, una por día durante un mes y una por mes durante un
          año. Si vuelves a una copia anterior, lo que tienes ahora se aparta (no se borra) y lo restaurado llega también a tus otros equipos.
        </p>
        <section class="tarjeta">
          <h2>Copias</h2>
          ${recientes.length ? tabla(recientes.map((x) => fila(x.archivo, x.marca, x.equipo))) : vacio("Aún no hay copias.")}
        </section>
        ${apartadas.length
          ? html`<section class="tarjeta">
              <h2>Versiones apartadas</h2>
              <p class="apagado pequeno">Las que quedaron fuera al resolver un conflicto, restaurar o importar. Se borran solas a los 30 días.</p>
              ${tabla(apartadas.map((x) => fila(x.archivo, x.marca!, x.id.split("-")[2] ?? "")))}
            </section>`
          : ""}
        <section class="tarjeta">
          <h2>Exportar e importar</h2>
          <p class="apagado">El JSON sirve como copia fuera de Drive. Al importarlo se sustituye todo lo que tienes ahora (que queda apartado por si acaso).</p>
          <div class="botones bloque"><a class="boton" href="/ajustes/exportar" hx-boost="false" data-exportar>Exportar a JSON</a></div>
          <form method="post" action="/ajustes/copias/importar" enctype="multipart/form-data" class="formulario" hx-boost="false" data-subir-en-crudo>
            <div class="campo">
              <label for="campo-json">Archivo exportado (.json)</label>
              <input id="campo-json" type="file" name="archivo" accept=".json,application/json" required />
            </div>
            <div class="botones"><button class="boton" type="submit">Importar y sustituir mis datos</button></div>
          </form>
        </section>
      `,
    );
  });
}
