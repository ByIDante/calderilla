import type { Hono } from "hono";
import { html } from "hono/html";
import { importeEditable, numeroEditable } from "../../dominio/dinero.ts";
import { formatoFecha, mesDe, nombreMes, nombreMesCorto, sumarMesesAMes, ultimoDia } from "../../dominio/fechas.ts";
import { NOMBRE_ETAPA, type Etapa } from "../../reglas/tipos.ts";
import { cerrarMes, leerCierres } from "../../servicios/cierres.ts";
import { guardarSaldo, leerCuentas, NOMBRE_TIPO_CUENTA, type Cuenta, type TipoCuenta } from "../../servicios/cuentas.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { botonAccion, campo, eur, eurR, pct, selector, vacio, type Html } from "../vistas/comun.ts";

const TIPOS = Object.entries(NOMBRE_TIPO_CUENTA) as [TipoCuenta, string][];

function formularioCuenta(accion: string, cuenta: Cuenta | null): Html {
  return html`<form method="post" action="${accion}" class="formulario">
    <div class="fila-campos">
      ${campo({ etiqueta: "Nombre", nombre: "nombre", valor: cuenta?.nombre, requerido: true, marcador: "Nómina, ahorro…", id: `nombre-${cuenta?.id ?? "nueva"}` })}
      ${selector("Tipo", "tipo", TIPOS, cuenta?.tipo ?? "corriente")}
      ${campo({ etiqueta: "Entidad", nombre: "entidad", valor: cuenta?.entidad, marcador: "Banco o bróker", ayuda: "Para avisarte si superas los 100.000 € del fondo de garantía.", id: `entidad-${cuenta?.id ?? "nueva"}` })}
    </div>
    <div class="fila-campos">
      ${cuenta ? "" : campo({ etiqueta: "Saldo actual", nombre: "saldo", sufijo: "€", id: "saldo-nueva" })}
      ${campo({ etiqueta: "TAE (opcional)", nombre: "tae", valor: numeroEditable(cuenta?.tae), sufijo: "%", id: `tae-${cuenta?.id ?? "nueva"}` })}
      ${campo({ etiqueta: "Vence (depósitos y Letras)", nombre: "vencimiento", valor: cuenta?.vencimiento, tipo: "date", id: `vence-${cuenta?.id ?? "nueva"}` })}
      ${campo({ etiqueta: "Moneda", nombre: "moneda", valor: cuenta?.moneda ?? "EUR", id: `moneda-${cuenta?.id ?? "nueva"}` })}
    </div>
    <div class="botones"><button class="boton boton-principal" type="submit">${cuenta ? "Guardar" : "Añadir cuenta"}</button></div>
  </form>`;
}

function leerCuenta(f: Formulario): { error: string } | { nombre: string; tipo: TipoCuenta; entidad: string | null; moneda: string; tae: number | null; vencimiento: string | null } {
  const nombre = f.texto("nombre");
  const tipo = TIPOS.find(([t]) => t === f.texto("tipo"))?.[0];
  const moneda = (f.texto("moneda") || "EUR").toUpperCase();
  if (!nombre) return { error: "Falta el nombre de la cuenta." };
  if (!tipo) return { error: "Tipo de cuenta no válido." };
  if (!/^[A-Z]{3}$/.test(moneda)) return { error: "La moneda son tres letras: EUR, USD…" };
  return { nombre, tipo, entidad: f.opcional("entidad"), moneda, tae: f.numero("tae"), vencimiento: f.fecha("vencimiento") };
}

export function rutasCuentas(app: Hono, estado: Estado) {
  app.get("/cuentas", (c) => {
    const hoy = estado.hoy();
    const cuentas = leerCuentas(bd(estado), hoy, true);
    const activas = cuentas.filter((cuenta) => !cuenta.archivada);
    const cierres = leerCierres(bd(estado), 12);
    return render(
      c,
      estado,
      { titulo: "Cuentas y cierres", seccion: "cuentas" },
      html`
        <div class="botones bloque"><a class="boton boton-principal" href="/cierre">Cerrar un mes</a></div>
        <section class="tarjeta">
          <h2>Tus cuentas</h2>
          ${activas.length
            ? html`<div class="tabla-contenedor">
                <table>
                  <thead><tr><th>Cuenta</th><th>Tipo</th><th class="numero">Saldo</th><th>Actualizar saldo</th></tr></thead>
                  <tbody>
                    ${activas.map(
                      (cuenta) => html`<tr>
                        <td>
                          <details>
                            <summary>${cuenta.nombre}</summary>
                            ${formularioCuenta(`/cuentas/${cuenta.id}`, cuenta)}
                            ${botonAccion(`/cuentas/${cuenta.id}/archivar`, "Archivar (ya no la uso)", { estilo: "enlace", confirmar: "¿Archivar esta cuenta? Su historial se conserva." })}
                          </details>
                          <div class="apagado pequeno">${[cuenta.entidad, cuenta.tae ? pct(cuenta.tae) : null, cuenta.vencimiento ? `vence ${formatoFecha(cuenta.vencimiento)}` : null].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td>${NOMBRE_TIPO_CUENTA[cuenta.tipo]}</td>
                        <td class="numero">${eur(cuenta.saldo)} ${cuenta.moneda === "EUR" ? "" : cuenta.moneda}<div class="apagado pequeno">${cuenta.saldoFecha ? formatoFecha(cuenta.saldoFecha) : "sin saldo"}</div></td>
                        <td>
                          <form method="post" action="/cuentas/${cuenta.id}/saldo" class="botones">
                            <input type="text" inputmode="decimal" name="saldo" value="${importeEditable(cuenta.saldo)}" aria-label="Saldo de ${cuenta.nombre}" style="max-width:130px" />
                            <button class="boton boton-pequeno" type="submit">Guardar</button>
                          </form>
                        </td>
                      </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : vacio("Añade tus cuentas con su saldo actual: la corriente, la de ahorro, el efectivo en el bróker, el plan de pensiones…")}
        </section>
        <section class="tarjeta">
          <h2>Añadir una cuenta</h2>
          ${formularioCuenta("/cuentas", null)}
        </section>
        <section class="tarjeta">
          <h2>Cierres de mes</h2>
          ${cierres.length
            ? html`<div class="tabla-contenedor">
                <table>
                  <thead>
                    <tr><th>Mes</th><th class="numero">Ahorro previsto</th><th class="numero">Ahorro real</th><th class="numero">Ocio</th><th>Etapa</th></tr>
                  </thead>
                  <tbody>
                    ${cierres.map(
                      (cierre) => html`<tr>
                        <td>${nombreMesCorto(cierre.mes)}</td>
                        <td class="numero">${eur(cierre.ahorro_plan)}</td>
                        <td class="numero ${cierre.ahorro_real !== null && cierre.ahorro_real < cierre.ahorro_plan ? "negativo" : ""}">${cierre.ahorro_real === null ? "—" : eur(cierre.ahorro_real)}</td>
                        <td class="numero">${eur(cierre.ocio_gastado)} de ${eur(cierre.ocio_plan)}</td>
                        <td>${NOMBRE_ETAPA[cierre.etapa as Etapa] ?? cierre.etapa}</td>
                      </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : vacio("Aún no has cerrado ningún mes.")}
        </section>
      `,
    );
  });

  app.post("/cuentas", async (c) => {
    const f = await Formulario.de(c);
    const leida = leerCuenta(f);
    if ("error" in leida) return redirigir(c, "/cuentas", { error: leida.error });
    const base = bd(estado);
    base.transaccion(() => {
      const { id } = base.ejecutar(
        "INSERT INTO cuentas (nombre, tipo, entidad, moneda, tae, vencimiento) VALUES (?, ?, ?, ?, ?, ?)",
        leida.nombre,
        leida.tipo,
        leida.entidad,
        leida.moneda,
        leida.tae,
        leida.vencimiento,
      );
      guardarSaldo(base, id, estado.hoy(), f.importe("saldo") ?? 0);
    });
    return redirigir(c, "/cuentas", { ok: `Añadida «${leida.nombre}».` });
  });

  app.post("/cuentas/:id", async (c) => {
    const leida = leerCuenta(await Formulario.de(c));
    if ("error" in leida) return redirigir(c, "/cuentas", { error: leida.error });
    bd(estado).ejecutar(
      "UPDATE cuentas SET nombre = ?, tipo = ?, entidad = ?, moneda = ?, tae = ?, vencimiento = ? WHERE id = ?",
      leida.nombre,
      leida.tipo,
      leida.entidad,
      leida.moneda,
      leida.tae,
      leida.vencimiento,
      idDe(c),
    );
    return redirigir(c, "/cuentas", { ok: "Cuenta guardada." });
  });

  app.post("/cuentas/:id/saldo", async (c) => {
    const saldo = (await Formulario.de(c)).importe("saldo");
    if (saldo === null) return redirigir(c, "/cuentas", { error: "El saldo no es un número." });
    guardarSaldo(bd(estado), idDe(c), estado.hoy(), saldo);
    return redirigir(c, "/cuentas", { ok: "Saldo actualizado." });
  });

  app.post("/cuentas/:id/archivar", (c) => {
    bd(estado).ejecutar("UPDATE cuentas SET archivada = 1 WHERE id = ?", idDe(c));
    return redirigir(c, "/cuentas", { ok: "Cuenta archivada." });
  });

  app.get("/cierre", (c) => {
    const hoy = estado.hoy();
    const pedido = c.req.query("mes") ?? "";
    const mes = /^\d{4}-\d{2}$/.test(pedido) && pedido <= mesDe(hoy) ? pedido : sumarMesesAMes(mesDe(hoy), -1);
    const cuentas = leerCuentas(bd(estado), ultimoDia(mes));
    const yaCerrado = bd(estado).uno<{ mes: string }>("SELECT mes FROM cierres_mes WHERE mes = ?", mes);
    const meses = Array.from({ length: 12 }, (_, i) => sumarMesesAMes(mesDe(hoy), -i));
    return render(
      c,
      estado,
      { titulo: `Cerrar ${nombreMes(mes)}`, seccion: "cuentas" },
      html`
        <section class="tarjeta">
          <form method="get" action="/cierre" class="botones">
            <label for="campo-mes">Mes</label>
            <select id="campo-mes" name="mes" style="max-width:220px">
              ${meses.map((m) => html`<option value="${m}" ${m === mes ? html`selected` : ""}>${nombreMes(m)}</option>`)}
            </select>
            <button class="boton boton-pequeno" type="submit">Cambiar</button>
          </form>
        </section>
        <section class="tarjeta">
          <h2>Saldos a final de ${nombreMes(mes)}</h2>
          <p class="apagado">
            Mira el saldo de cada cuenta a último día del mes (en la app del banco) y apúntalo. Con eso se calcula cuánto has ahorrado de verdad y se compara con lo previsto.
            Las inversiones cuentan a precio de compra, así que las subidas o bajadas de la bolsa no cuentan como ahorro.
          </p>
          ${yaCerrado ? html`<p><b>Este mes ya está cerrado.</b> Si lo vuelves a cerrar, se recalcula con los saldos que pongas.</p>` : ""}
          ${cuentas.length
            ? html`<form method="post" action="/cierre" class="formulario">
                <input type="hidden" name="mes" value="${mes}" />
                <div class="fila-campos">
                  ${cuentas.map((cuenta) =>
                    campo({
                      etiqueta: cuenta.nombre,
                      nombre: `saldo_${cuenta.id}`,
                      valor: importeEditable(cuenta.saldo),
                      sufijo: cuenta.moneda === "EUR" ? "€" : cuenta.moneda,
                      ayuda: cuenta.saldoFecha ? `Último dato: ${formatoFecha(cuenta.saldoFecha)}` : "Sin saldo anterior",
                    }),
                  )}
                </div>
                <div class="botones"><button class="boton boton-principal" type="submit">Cerrar ${nombreMes(mes)}</button></div>
              </form>`
            : vacio("Primero añade tus cuentas.", html`<a class="boton" href="/cuentas">Ir a cuentas</a>`)}
        </section>
      `,
    );
  });

  app.post("/cierre", async (c) => {
    const f = await Formulario.de(c);
    const mes = f.texto("mes");
    if (!/^\d{4}-\d{2}$/.test(mes)) return redirigir(c, "/cierre", { error: "Mes no válido." });
    const cuentas = leerCuentas(bd(estado), ultimoDia(mes));
    const saldos = [];
    for (const cuenta of cuentas) {
      const saldo = f.importe(`saldo_${cuenta.id}`);
      if (saldo === null) return redirigir(c, `/cierre?mes=${mes}`, { error: `El saldo de «${cuenta.nombre}» no es un número.` });
      saldos.push({ cuentaId: cuenta.id, saldo });
    }
    const cierre = cerrarMes(bd(estado), mes, saldos);
    const resumen =
      cierre.ahorro_real === null
        ? `${nombreMes(mes)} cerrado. Es tu primer cierre: a partir del siguiente verás cuánto ahorras de verdad.`
        : `${nombreMes(mes)} cerrado: has ahorrado ${eurR(cierre.ahorro_real)} (previsto ${eurR(cierre.ahorro_plan)}).`;
    return redirigir(c, "/cuentas", { ok: resumen });
  });
}
