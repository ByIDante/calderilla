import type { Hono } from "hono";
import { html } from "hono/html";
import type { ResumenVersion } from "../../datos/copias.ts";
import { importarJson } from "../../servicios/importarJson.ts";
import { bd, render, type Estado } from "../estado.ts";
import { Formulario, redirigir } from "../formulario.ts";
import { aviso, botonAccion } from "../vistas/comun.ts";

/** Guardar una copia, volver a una anterior, importar un JSON y resolver un conflicto: en el móvil, todo esto espera a Drive. */
export function rutasCopias(app: Hono, estado: Estado) {
  app.post("/ajustes/copiar", async (c) => {
    const decision = await estado.sync!.comprobar();
    if (estado.sync!.estado.tipo === "error") return redirigir(c, "/ajustes", { error: "No se ha podido guardar la copia." });
    return redirigir(c, "/ajustes", { ok: decision?.tipo === "nada" ? "No había cambios: la última copia ya está al día." : "Copia guardada." });
  });

  app.post("/ajustes/copias/restaurar", async (c) => {
    const archivo = (await Formulario.de(c)).texto("archivo");
    try {
      await estado.sync!.restaurar(archivo);
      return redirigir(c, "/", { ok: "Datos restaurados. Lo que tenías antes está en «Versiones apartadas», por si quieres deshacerlo." });
    } catch (error) {
      return redirigir(c, "/ajustes/copias", { error: (error as Error).message });
    }
  });

  app.post("/ajustes/copias/importar", async (c) => {
    const archivo = (await c.req.parseBody()).archivo;
    if (!(archivo instanceof File) || archivo.size === 0) return redirigir(c, "/ajustes/copias", { error: "Elige el archivo .json exportado." });
    try {
      const datos = JSON.parse(await archivo.text()) as unknown;
      await estado.sync!.copiaDeSeguridad();
      const { filas } = importarJson(bd(estado), datos);
      return redirigir(c, "/", { ok: `Importado: ${filas} registros. Lo que tenías antes está en «Versiones apartadas».` });
    } catch (error) {
      return redirigir(c, "/ajustes/copias", { error: error instanceof SyntaxError ? "Ese archivo no es un JSON válido." : (error as Error).message });
    }
  });

  // ── Conflictos de sincronización ──
  app.get("/ajustes/conflicto", async (c) => {
    const sync = estado.sync!;
    if (sync.estado.tipo !== "conflicto") return redirigir(c, "/");
    const { versiones, localConCambios } = sync.estado;
    // De una en una, como al leerlas del disco (en el móvil, cada una se descarga)
    const resumenes: ResumenVersion[] = [];
    for (const version of versiones) resumenes.push(await sync.resumen(version));
    const local = await sync.resumen(null);
    const todas = localConCambios ? [local, ...resumenes] : resumenes;
    // Lo que solo aparece en una versión ayuda a reconocer cuál tiene los últimos cambios
    const soloEn = (r: ResumenVersion) => r.nombres.filter((nombre) => todas.some((otra) => otra !== r && !otra.nombres.includes(nombre)));
    const tarjeta = (titulo: string, r: ResumenVersion, eleccion: string) => html`<article class="version">
      <h3>${titulo}</h3>
      ${soloEn(r).length
        ? html`<p class="pequeno"><b>Solo en esta versión:</b> ${soloEn(r).join(", ")}</p>`
        : html`<p class="apagado pequeno">No tiene nada que no esté en las demás (pueden cambiar importes o saldos).</p>`}
      <ul class="lista-plana">
        <li><span>Guardada en</span><span>${r.equipo}</span></li>
        <li><span>Último cambio</span><span>${r.guardada ? new Date(r.guardada).toLocaleString("es-ES") : "?"}</span></li>
        <li><span>Ingresos y gastos fijos</span><span>${r.recurrentes}</span></li>
        <li><span>Apuntes</span><span>${r.apuntes}</span></li>
        <li><span>Cuentas</span><span>${r.cuentas}</span></li>
        <li><span>Inversiones</span><span>${r.activos}</span></li>
      </ul>
      ${botonAccion("/ajustes/conflicto", "Quedarme con esta", { estilo: "secundario", campos: { eleccion }, confirmar: "Las otras versiones quedarán apartadas en la carpeta de copias. ¿Seguir?" })}
    </article>`;
    return render(
      c,
      estado,
      { titulo: "Hay dos versiones de tus datos", seccion: "ajustes" },
      html`
        ${aviso(
          "atencion",
          "Se han guardado cambios en dos sitios a la vez (en otro ordenador, o aquí mientras la carpeta no estaba sincronizada). Calderilla no mezcla nada por su cuenta: elige con qué versión sigues. Las demás no se borran, quedan apartadas en la carpeta de copias.",
        )}
        <div class="opciones">
          ${localConCambios ? tarjeta(`${estado.esteEquipo ?? "Este ordenador"} (con cambios sin guardar)`, local, "local") : ""}
          ${versiones.map((v, i) => tarjeta(`Versión de ${resumenes[i]!.equipo}`, resumenes[i]!, v.archivo))}
        </div>
      `,
    );
  });

  app.post("/ajustes/conflicto", async (c) => {
    const eleccion = (await Formulario.de(c)).texto("eleccion");
    try {
      await estado.sync!.resolver(eleccion);
      return redirigir(c, "/", { ok: "Conflicto resuelto." });
    } catch (error) {
      return redirigir(c, "/ajustes/conflicto", { error: (error as Error).message });
    }
  });
}
