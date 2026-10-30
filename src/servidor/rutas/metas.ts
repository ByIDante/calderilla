import type { Hono } from "hono";
import { html } from "hono/html";
import { importeEditable } from "../../dominio/dinero.ts";
import { diferenciaMeses, formatoFecha } from "../../dominio/fechas.ts";
import { leerParametros } from "../../servicios/configuracion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { barra, botonAccion, campo, eur, vacio } from "../vistas/comun.ts";

interface Meta {
  id: number;
  nombre: string;
  objetivo: number;
  fecha: string;
  ahorrado: number;
  cumplida: number;
}

export function rutasMetas(app: Hono, estado: Estado) {
  app.get("/metas", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    const p = leerParametros(base);
    const metas = base.todos<Meta>("SELECT * FROM metas ORDER BY cumplida, fecha");
    return render(
      c,
      estado,
      { titulo: "Metas", seccion: "metas" },
      html`
        <p class="apagado">
          Un viaje, la entrada de un piso, cambiar de coche… Lo que tengas apartado para una meta no cuenta como liquidez libre, y la regla te dice cuánto apartar cada mes.
          Si falta menos de ${p.metasCortoMeses} meses, el dinero no debe ir a bolsa.
        </p>
        ${metas.length
          ? html`<div class="opciones bloque">
              ${metas.map((m) => {
                const meses = Math.max(1, diferenciaMeses(hoy, m.fecha));
                const falta = Math.max(0, m.objetivo - m.ahorrado);
                return html`<article class="opcion ${m.cumplida ? "opcion-bloqueada" : ""}">
                  <h3>${m.nombre}${m.cumplida ? html`<span class="etiqueta etiqueta-si">Cumplida</span>` : ""}</h3>
                  ${barra(m.ahorrado, m.objetivo, `Progreso de ${m.nombre}`)}
                  <p class="pequeno">${eur(m.ahorrado)} de ${eur(m.objetivo)} · para el ${formatoFecha(m.fecha)}</p>
                  ${!m.cumplida && falta > 0
                    ? html`<p class="pequeno">Faltan ${eur(falta)}: unos <b>${eur(Math.ceil(falta / meses))} al mes</b> durante ${meses} meses.</p>`
                    : ""}
                  <form method="post" action="/metas/${m.id}" class="botones">
                    <input type="text" inputmode="decimal" name="ahorrado" value="${importeEditable(m.ahorrado)}" aria-label="Ahorrado para ${m.nombre}" style="max-width:120px" />
                    <button class="boton boton-pequeno" type="submit">Actualizar lo ahorrado</button>
                  </form>
                  <p class="botones" style="margin-top:8px">
                    ${m.cumplida ? "" : botonAccion(`/metas/${m.id}/cumplida`, "Marcar como cumplida", { estilo: "enlace" })}
                    ${botonAccion(`/metas/${m.id}/borrar`, "Borrar", { estilo: "enlace", confirmar: `¿Borrar la meta «${m.nombre}»?` })}
                  </p>
                </article>`;
              })}
            </div>`
          : vacio("Aún no tienes metas.")}
        <section class="tarjeta">
          <h2>Nueva meta</h2>
          <form method="post" action="/metas" class="formulario">
            <div class="fila-campos">
              ${campo({ etiqueta: "Qué", nombre: "nombre", requerido: true, marcador: "Viaje a Japón" })} ${campo({ etiqueta: "Cuánto", nombre: "objetivo", sufijo: "€", requerido: true })}
              ${campo({ etiqueta: "Para cuándo", nombre: "fecha", tipo: "date", requerido: true })} ${campo({ etiqueta: "Ya apartado", nombre: "ahorrado", sufijo: "€", valor: "0" })}
            </div>
            <div class="botones"><button class="boton boton-principal" type="submit">Añadir meta</button></div>
          </form>
        </section>
      `,
    );
  });

  app.post("/metas", async (c) => {
    const f = await Formulario.de(c);
    const nombre = f.texto("nombre");
    const objetivo = f.importe("objetivo");
    const fecha = f.fecha("fecha");
    if (!nombre || !objetivo || objetivo <= 0 || !fecha) return redirigir(c, "/metas", { error: "Indica qué, cuánto y para cuándo." });
    if (fecha <= estado.hoy()) return redirigir(c, "/metas", { error: "La fecha tiene que ser futura." });
    bd(estado).ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado) VALUES (?, ?, ?, ?)", nombre, objetivo, fecha, f.importe("ahorrado") ?? 0);
    return redirigir(c, "/metas", { ok: `Meta «${nombre}» añadida.` });
  });

  app.post("/metas/:id", async (c) => {
    const ahorrado = (await Formulario.de(c)).importe("ahorrado");
    if (ahorrado === null || ahorrado < 0) return redirigir(c, "/metas", { error: "Lo ahorrado no es un número." });
    bd(estado).ejecutar("UPDATE metas SET ahorrado = ? WHERE id = ?", ahorrado, idDe(c));
    return redirigir(c, "/metas", { ok: "Actualizado." });
  });

  app.post("/metas/:id/cumplida", (c) => {
    bd(estado).ejecutar("UPDATE metas SET cumplida = 1 WHERE id = ?", idDe(c));
    return redirigir(c, "/metas", { ok: "¡Meta cumplida!" });
  });

  app.post("/metas/:id/borrar", (c) => {
    bd(estado).ejecutar("DELETE FROM metas WHERE id = ?", idDe(c));
    return redirigir(c, "/metas", { ok: "Meta borrada." });
  });
}
