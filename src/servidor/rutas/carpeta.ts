import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { html } from "hono/html";
import { carpetaAjustes, carpetasSugeridas } from "../../config/ajustes.ts";
import { fechaDeMarca } from "../../datos/copias.ts";
import type { Estado } from "../app.ts";
import { render } from "../estado.ts";
import { Formulario, redirigir } from "../formulario.ts";
import { botonAccion, campo, vacio, type Html } from "../vistas/comun.ts";

/** Las tarjetas «Este ordenador» y «Servicios vinculados» de Ajustes: lo que solo tiene el PC. */
export function tarjetasEquipo(estado: Estado): Html {
  const sync = estado.sync!;
  const { copias } = sync.listar();
  const local = sync.estadoLocal();
  const ultima = copias.find((copia) => copia.id === local.base);
  return html`<section class="tarjeta">
            <h2>Este ordenador</h2>
            <ul class="lista-plana">
              <li><span>Nombre</span><span>${estado.ajustes.equipoNombre}</span></li>
              <li><span>Carpeta de datos</span><code class="pequeno">${estado.ajustes.carpetaDatos}</code></li>
              <li><span>Última copia</span><span>${ultima ? `${ultima.marca.slice(6, 8)}/${ultima.marca.slice(4, 6)}/${ultima.marca.slice(0, 4)} ${ultima.marca.slice(8, 10)}:${ultima.marca.slice(10, 12)} UTC` : "ninguna"}</span></li>
              <li><span>Copias guardadas</span><span>${copias.length}</span></li>
              <li><span>Cambios sin copiar</span><span>${local.sucio ? "sí (se copian en unos segundos)" : "no"}</span></li>
            </ul>
            <div class="botones" style="margin-top:10px">
              ${botonAccion("/ajustes/copiar", "Guardar copia ahora")}
              <a class="boton" href="/ajustes/copias">Copias de seguridad</a>
              ${botonAccion("/salir", "Cerrar Calderilla", { estilo: "peligro", confirmar: "¿Cerrar Calderilla? Se guarda todo antes de salir." })}
              <a class="boton" href="/ajustes/exportar" hx-boost="false">Exportar a JSON</a>
            </div>
            <details style="margin-top:12px">
              <summary>Cambiar la carpeta de datos</summary>
              <form method="post" action="/ajustes/carpeta" class="formulario" style="margin-top:8px">
                ${campo({ etiqueta: "Nueva carpeta", nombre: "carpeta", valor: estado.ajustes.carpetaDatos, ayuda: "Antes de cambiar se guarda una copia en la carpeta actual. Si la nueva ya tiene datos de Calderilla, se cargan." })}
                <div class="botones"><button class="boton" type="submit">Cambiar</button></div>
              </form>
            </details>
          </section>
          <section class="tarjeta">
            <h2>Servicios vinculados</h2>
            <p class="apagado pequeno">Se guardan solo en este ordenador: el otro tendrá los suyos.</p>
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
            <ul class="lista-plana" style="margin-top:12px">
              <li><a href="/bancos">Conectar tu banco (Enable Banking)</a><span class="apagado pequeno">saldos y movimientos automáticos</span></li>
              <li><a href="/importar">Importar un extracto</a><span class="apagado pequeno">CSV o Excel, cualquier banco</span></li>
            </ul>
          </section>`;
}

/** Lo de Ajustes que solo tiene el PC: elegir la carpeta de datos, la clave de CoinGecko de este ordenador y la lista de copias. */
export function rutasCarpeta(app: Hono, estado: Estado) {
  app.get("/bienvenida", (c) => {
    const sugeridas = carpetasSugeridas();
    return render(
        c,
        estado,
        { titulo: "Bienvenido a Calderilla", seccion: "bienvenida" },
        html`<section class="tarjeta">
          <h2>¿Dónde guardo tus datos?</h2>
          <p>
            Elige una carpeta que se sincronice entre tus ordenadores (Google Drive, Dropbox, OneDrive, Syncthing…). Calderilla guarda allí una copia cada vez que cambias algo,
            y nunca sobrescribe una copia anterior: si usas la app en dos ordenadores a la vez, te avisa y eliges qué versión vale.
          </p>
          <p class="apagado">Si en el otro ordenador ya usas Calderilla, elige la misma carpeta y se cargarán tus datos.</p>
          ${sugeridas.length
            ? html`<p>Carpetas que he encontrado en este ordenador:</p>
                <ul>${sugeridas.map((s) => html`<li><code>${s}</code></li>`)}</ul>`
            : ""}
          <form method="post" action="/bienvenida" class="formulario">
            ${campo({ etiqueta: "Carpeta de datos", nombre: "carpeta", valor: sugeridas[0] ?? "", requerido: true, ayuda: "Ruta completa. Si no existe, se crea." })}
            <div class="botones"><button class="boton boton-principal" type="submit">Usar esta carpeta</button></div>
          </form>
          <p class="apagado pequeno">Los ajustes de este ordenador (esta carpeta, claves…) se guardan aparte, en <code>${carpetaAjustes()}</code>, y no se suben a ningún sitio.</p>
        </section>`,
    );
  });

  app.post("/bienvenida", async (c) => {
    const carpeta = (await Formulario.de(c)).texto("carpeta");
    if (!carpeta || !path.isAbsolute(carpeta)) return redirigir(c, "/bienvenida", { error: "Escribe la ruta completa de la carpeta." });
    try {
      mkdirSync(carpeta, { recursive: true });
      if (!statSync(carpeta).isDirectory()) throw new Error("No es una carpeta.");
      const habiaDatos = existsSync(path.join(carpeta, "copias"));
      estado.usarCarpeta(carpeta);
      return habiaDatos
        ? redirigir(c, "/", { ok: "Datos cargados desde la carpeta." })
        : redirigir(c, "/ajustes", { ok: "¡Listo! Empieza por tu perfil: cambia las recomendaciones." });
    } catch (error) {
      return redirigir(c, "/bienvenida", { error: `No se puede usar esa carpeta: ${(error as Error).message}` });
    }
  });

  app.post("/ajustes/vinculos", async (c) => {
    const clave = (await Formulario.de(c)).opcional("coingeckoClave");
    estado.ajustes.coingeckoClave = clave;
    estado.guardarAjustes(estado.ajustes);
    return redirigir(c, "/ajustes", { ok: clave ? "Clave de CoinGecko guardada en este ordenador." : "Clave de CoinGecko quitada." });
  });

  app.post("/ajustes/carpeta", async (c) => {
    const carpeta = (await Formulario.de(c)).texto("carpeta");
    if (!carpeta || !path.isAbsolute(carpeta)) return redirigir(c, "/ajustes", { error: "Escribe la ruta completa de la carpeta." });
    if (carpeta === estado.ajustes.carpetaDatos) return redirigir(c, "/ajustes");
    try {
      mkdirSync(carpeta, { recursive: true });
      estado.sync?.comprobar();
      estado.usarCarpeta(carpeta);
      return redirigir(c, "/ajustes", { ok: "Carpeta cambiada." });
    } catch (error) {
      return redirigir(c, "/ajustes", { error: `No se puede usar esa carpeta: ${(error as Error).message}` });
    }
  });

  app.get("/ajustes/copias", (c) => {
    const sync = estado.sync!;
    const { copias, rastros } = sync.listar();
    const fecha = (marca: string) => fechaDeMarca(marca).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
    const fila = (archivo: string, marca: string, equipo: string) => {
      const r = sync.resumen({ archivo, equipo });
      return html`<tr>
        <td>${fecha(marca)}</td>
        <td>${r.equipo}${equipo === estado.ajustes.equipoId ? " (este)" : ""}</td>
        <td class="pequeno">${r.recurrentes} ingresos y gastos · ${r.cuentas} cuentas · ${r.apuntes} movimientos · ${r.activos} inversiones</td>
        <td>${botonAccion("/ajustes/copias/restaurar", "Volver a esta", { campos: { archivo }, confirmar: `¿Volver a los datos del ${fecha(marca)}? Lo de ahora queda guardado aparte por si quieres deshacerlo.` })}</td>
      </tr>`;
    };
    const recientes = [...copias].sort((a, b) => b.marca.localeCompare(a.marca)).slice(0, 40);
    const apartadas = rastros.filter((r) => r.marca && r.archivo.endsWith(".db")).sort((a, b) => b.marca!.localeCompare(a.marca!));
    const tabla = (filas: Html[]) => html`<div class="tabla-contenedor">
      <table class="tabla-apilable tabla-acciones">
        <thead><tr><th>Guardada</th><th>Ordenador</th><th>Contenido</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
    return render(
      c,
      estado,
      { titulo: "Copias de seguridad", seccion: "ajustes" },
      html`
        <p><a href="/ajustes">← Ajustes</a></p>
        <p class="apagado">
          Calderilla guarda una copia cada vez que cambias algo: todas las de la última semana, una por día durante un mes y una por mes durante un año. Si vuelves a
          una copia anterior, lo que tienes ahora se aparta (no se borra) y lo restaurado llega también a tu otro ordenador.
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
          <p class="apagado">El JSON sirve como copia fuera de la carpeta de datos. Al importarlo se sustituye todo lo que tienes ahora (que queda apartado por si acaso).</p>
          <div class="botones bloque"><a class="boton" href="/ajustes/exportar" hx-boost="false">Exportar a JSON</a></div>
          <form method="post" action="/ajustes/copias/importar" enctype="multipart/form-data" class="formulario" hx-boost="false">
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
