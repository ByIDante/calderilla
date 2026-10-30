import type { Hono } from "hono";
import { html } from "hono/html";
import { importeEditable } from "../../dominio/dinero.ts";
import { diferenciaMeses, formatoFecha } from "../../dominio/fechas.ts";
import { leerParametros } from "../../servicios/configuracion.ts";
import { leerCuentas } from "../../servicios/cuentas.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { barra, botonAccion, campo, eur, selector, vacio } from "../vistas/comun.ts";

interface Meta {
  id: number;
  nombre: string;
  objetivo: number;
  fecha: string;
  ahorrado: number;
  cumplida: number;
  cuenta_id: number | null;
}

export function rutasMetas(app: Hono, estado: Estado) {
  app.get("/metas", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    const p = leerParametros(base);
    const cuentas = leerCuentas(base, hoy);
    const saldoDe = new Map(cuentas.map((x) => [x.id, x]));
    // Si la meta va unida a una cuenta, lo ahorrado es su saldo (como mucho, el objetivo)
    const metas = base.todos<Meta>("SELECT * FROM metas ORDER BY cumplida, fecha").map((m) => {
      const cuenta = m.cuenta_id ? saldoDe.get(m.cuenta_id) : undefined;
      return { ...m, ahorrado: cuenta ? Math.min(Math.max(cuenta.saldo, 0), m.objetivo) : m.ahorrado, cuenta: cuenta?.nombre ?? null };
    });
    const opcionesCuenta = [["", "Ninguna: lo actualizo a mano"] as const, ...cuentas.filter((x) => x.tipo !== "plan_pensiones").map((x) => [String(x.id), x.nombre] as const)];
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
                  ${m.cuenta
                    ? html`<p class="apagado pequeno">Unida a la cuenta «${m.cuenta}»: lo ahorrado se actualiza solo con su saldo.</p>`
                    : html`<form method="post" action="/metas/${m.id}" class="botones">
                        <input type="text" inputmode="decimal" name="ahorrado" value="${importeEditable(m.ahorrado)}" aria-label="Ahorrado para ${m.nombre}" style="max-width:120px" />
                        <button class="boton boton-pequeno" type="submit">Actualizar lo ahorrado</button>
                      </form>`}
                  <details>
                    <summary class="pequeno">${m.cuenta ? "Cambiar la cuenta" : "Unirla a una cuenta"}</summary>
                    <form method="post" action="/metas/${m.id}/cuenta" class="botones" style="margin-top:6px">
                      <select name="cuenta" aria-label="Cuenta de ${m.nombre}" style="max-width:240px">
                        ${opcionesCuenta.map(([v, t]) => html`<option value="${v}" ${v === (m.cuenta_id ? String(m.cuenta_id) : "") ? html`selected` : ""}>${t}</option>`)}
                      </select>
                      <button class="boton boton-pequeno" type="submit">Guardar</button>
                    </form>
                  </details>
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
            ${selector("¿Lo apartas en una cuenta propia?", "cuenta", opcionesCuenta, "", "Si eliges una cuenta, lo ahorrado será su saldo y se actualizará solo. Úsalo solo si esa cuenta es solo para esta meta.")}
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
    bd(estado).ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado, cuenta_id) VALUES (?, ?, ?, ?, ?)", nombre, objetivo, fecha, f.importe("ahorrado") ?? 0, f.entero("cuenta"));
    return redirigir(c, "/metas", { ok: `Meta «${nombre}» añadida.` });
  });

  app.post("/metas/:id", async (c) => {
    const ahorrado = (await Formulario.de(c)).importe("ahorrado");
    if (ahorrado === null || ahorrado < 0) return redirigir(c, "/metas", { error: "Lo ahorrado no es un número." });
    bd(estado).ejecutar("UPDATE metas SET ahorrado = ? WHERE id = ?", ahorrado, idDe(c));
    return redirigir(c, "/metas", { ok: "Actualizado." });
  });

  app.post("/metas/:id/cuenta", async (c) => {
    const cuenta = (await Formulario.de(c)).entero("cuenta");
    bd(estado).ejecutar("UPDATE metas SET cuenta_id = ? WHERE id = ?", cuenta, idDe(c));
    return redirigir(c, "/metas", { ok: cuenta ? "Meta unida a la cuenta: lo ahorrado se actualiza solo." : "La meta ya no va unida a ninguna cuenta." });
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
