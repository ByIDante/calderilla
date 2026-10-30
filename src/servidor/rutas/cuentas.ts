import type { Hono } from "hono";
import { html } from "hono/html";
import { importeEditable, numeroEditable } from "../../dominio/dinero.ts";
import { formatoFecha, mesDe, nombreMes, nombreMesCorto, sumarMesesAMes, ultimoDia } from "../../dominio/fechas.ts";
import { NOMBRE_ETAPA, type Etapa } from "../../reglas/tipos.ts";
import { activaEn, historial, leerAportaciones, registrarMes, totalMensual, type Aportacion } from "../../servicios/aportaciones.ts";
import { leerActivos } from "../../servicios/cartera.ts";
import { cerrarMes, leerCierres } from "../../servicios/cierres.ts";
import { guardarSaldo, leerCuentas, NOMBRE_TIPO_CUENTA, type Cuenta, type TipoCuenta } from "../../servicios/cuentas.ts";
import { contexto } from "../../servicios/situacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { botonAccion, campo, eur, eurR, pct, selector, vacio, type Html } from "../vistas/comun.ts";

const TIPOS = Object.entries(NOMBRE_TIPO_CUENTA) as [TipoCuenta, string][];

function formularioCuenta(accion: string, cuenta: Cuenta | null): Html {
  return html`<form method="post" action="${accion}" class="formulario">
    <div class="fila-campos">
      ${campo({ etiqueta: "Nombre", nombre: "nombre", valor: cuenta?.nombre, requerido: true, marcador: "Nómina, ahorro…", id: `nombre-${cuenta?.id ?? "nueva"}` })}
      ${selector("Tipo", "tipo", TIPOS, cuenta?.tipo ?? "corriente", cuenta ? undefined : "Trade Republic y similares: «Cuenta remunerada».")}
      ${campo({ etiqueta: "Entidad", nombre: "entidad", valor: cuenta?.entidad, marcador: "Banco o bróker", ayuda: "Para avisarte si superas los 100.000 € del fondo de garantía.", id: `entidad-${cuenta?.id ?? "nueva"}` })}
    </div>
    <div class="fila-campos">
      ${cuenta ? "" : campo({ etiqueta: "Saldo actual", nombre: "saldo", sufijo: "€", id: "saldo-nueva" })}
      ${campo({ etiqueta: "TAE (opcional)", nombre: "tae", valor: numeroEditable(cuenta?.tae), sufijo: "%", ayuda: "Lo que te paga al año; sirve para estimar los intereses.", id: `tae-${cuenta?.id ?? "nueva"}` })}
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

/** Intereses aproximados de un mes, antes de impuestos. */
const interesesAlMes = (cuenta: Cuenta) => (cuenta.tae ? Math.round((cuenta.saldo * cuenta.tae) / 100 / 12) : 0);

const DONDE_VA = html`<details class="tarjeta">
  <summary><b>¿Dónde apunto cada cosa?</b></summary>
  <ul class="lista-plana" style="margin-top:8px">
    <li><span><b>Tu cuenta de Trade Republic</b> (u otra cuenta que paga intereses)</span><span>Aquí, en «Tus cuentas», tipo «Cuenta remunerada», con su TAE</span></li>
    <li><span><b>Lo que traspasas cada mes</b> a esa cuenta o a un fondo</span><span>En «Ahorro automático», aquí abajo. <b>No es un gasto</b>: es ahorro</span></li>
    <li><span><b>Los intereses</b> que te paga cada mes</span><span>No hace falta apuntarlos: aparecen al actualizar el saldo</span></li>
    <li><span><b>Tus fondos, ETF, acciones o cripto</b></span><span>En Inversiones</span></li>
    <li><span><b>Alquiler, recibos, préstamos, nómina</b></span><span>En Ingresos y gastos</span></li>
  </ul>
</details>`;

function marcaMes(aportado: number | undefined, previsto: number): string {
  if (aportado === undefined) return "·";
  if (aportado === 0) return "✗";
  return aportado < previsto ? "≈" : "✓";
}

function tarjetaAportaciones(aportaciones: Aportacion[], hechas: Map<number, Map<string, number>>, opciones: { mes: string; sugerido: number; etapa: string; cuentas: Cuenta[]; activos: { id: number; nombre: string }[]; hoy: string }): Html {
  const vivas = aportaciones.filter((a) => !a.fin || a.fin >= opciones.hoy);
  const total = totalMensual(vivas, opciones.mes);
  const meses = Array.from({ length: 6 }, (_, i) => sumarMesesAMes(opciones.mes, i - 6));
  const comparacion =
    total === 0
      ? `La regla sugiere ahorrar ${eurR(opciones.sugerido)} al mes en tu etapa («${opciones.etapa}»). Si tienes un traspaso automático a tu cuenta de ahorro o una compra periódica de un fondo, apúntalo aquí.`
      : total < opciones.sugerido
        ? `Tus aportaciones suman ${eurR(total)} al mes y la regla sugiere ${eurR(opciones.sugerido)}. Los ${eurR(opciones.sugerido - total)} restantes puedes dejarlos en la cuenta corriente: también cuentan como ahorro si no los gastas.`
        : `Tus aportaciones suman ${eurR(total)} al mes, ${total > opciones.sugerido ? `más de los ${eurR(opciones.sugerido)} que sugiere la regla. Bien, siempre que te quede para el día a día y el ocio` : "justo lo que sugiere la regla"}.`;
  const destinos = [
    ...opciones.cuentas.filter((x) => x.tipo !== "plan_pensiones").map((x) => [`c:${x.id}`, `Cuenta: ${x.nombre}`] as const),
    ...opciones.activos.map((x) => [`a:${x.id}`, `Inversión: ${x.nombre}`] as const),
  ];
  return html`<section class="tarjeta" id="ahorro-automatico">
    <h2>Ahorro automático</h2>
    <p>${comparacion}</p>
    ${vivas.length
      ? html`<div class="tabla-contenedor">
          <table>
            <thead><tr><th>Aportación</th><th class="numero">Al mes</th><th>Últimos meses</th><th></th></tr></thead>
            <tbody>
              ${vivas.map(
                (a) => html`<tr>
                  <td>${a.nombre}<div class="apagado pequeno">→ ${a.destino}, el día ${a.dia}${a.fin ? ` · hasta ${formatoFecha(a.fin)}` : ""}</div></td>
                  <td class="numero">${eur(a.importe)}</td>
                  <td>
                    ${meses.map((m) => {
                      const marca = activaEn(a, m) ? marcaMes(hechas.get(a.id)?.get(m), a.importe) : "";
                      return marca ? html`<span class="etiqueta ${marca === "✓" ? "etiqueta-si" : marca === "·" ? "etiqueta-no" : "etiqueta-neutra"}" title="${nombreMes(m)}">${nombreMesCorto(m).slice(0, 3)} ${marca}</span> ` : "";
                    })}
                  </td>
                  <td>
                    ${botonAccion(`/aportaciones/${a.id}/terminar`, "Dejar de hacerla", { estilo: "enlace", confirmar: "¿Dejas de hacer esta aportación desde hoy? Su historial se conserva." })}
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
        <p class="apagado pequeno">✓ hecha · ≈ hecha en parte · ✗ ese mes no se hizo · · mes aún sin cerrar. Se marca al cerrar cada mes.</p>`
      : ""}
    <details class="porque">
      <summary>¿Y si un mes no la hago?</summary>
      <p>
        No rompe nada. La escalera mira tus saldos reales: el objetivo de la etapa sigue igual y la fecha estimada se retrasa un poco. No hace falta «recuperarlo» al mes
        siguiente. Lo único que cambia: si en 2 de los 3 últimos cierres ahorras menos de lo previsto, la app entiende que hay gastos que no estás apuntando y baja tu
        presupuesto de ocio hasta que vuelva a cuadrar.
      </p>
    </details>
    <details style="margin-top:10px">
      <summary class="boton">Añadir una aportación</summary>
      ${destinos.length
        ? html`<form method="post" action="/aportaciones" class="formulario" style="margin-top:12px">
            <div class="fila-campos">
              ${campo({ etiqueta: "Nombre", nombre: "nombre", requerido: true, marcador: "Traspaso a Trade Republic" })}
              ${selector("Destino", "destino", destinos, destinos[0]?.[0])}
              ${campo({ etiqueta: "Importe al mes", nombre: "importe", sufijo: "€", requerido: true })}
              ${campo({ etiqueta: "Día del mes", nombre: "dia", valor: "1", sufijo: "", ayuda: "Cuándo sale de tu cuenta." })}
              ${campo({ etiqueta: "Desde", nombre: "inicio", tipo: "date", valor: opciones.hoy })}
            </div>
            <p class="apagado pequeno">Si el destino es un fondo, al cerrar cada mes se apunta la compra sola (las participaciones se calculan con el último precio, o las pones tú).</p>
            <div class="botones"><button class="boton boton-principal" type="submit">Añadir</button></div>
          </form>`
        : html`<p class="apagado">Primero añade la cuenta de destino (arriba) o el fondo (en Inversiones).</p>`}
    </details>
  </section>`;
}

export function rutasCuentas(app: Hono, estado: Estado) {
  app.get("/cuentas", (c) => {
    const hoy = estado.hoy();
    const cuentas = leerCuentas(bd(estado), hoy, true);
    const activas = cuentas.filter((cuenta) => !cuenta.archivada);
    const cierres = leerCierres(bd(estado), 12);
    const ctx = contexto(bd(estado), hoy);
    const intereses = activas.reduce((s, cuenta) => s + interesesAlMes(cuenta), 0);
    return render(
      c,
      estado,
      { titulo: "Cuentas y cierres", seccion: "cuentas" },
      html`
        <div class="botones bloque"><a class="boton boton-principal" href="/cierre">Cerrar un mes</a></div>
        ${DONDE_VA}
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
                        <td class="numero">
                          ${eur(cuenta.saldo)} ${cuenta.moneda === "EUR" ? "" : cuenta.moneda}
                          <div class="apagado pequeno">${cuenta.saldoFecha ? formatoFecha(cuenta.saldoFecha) : "sin saldo"}</div>
                          ${interesesAlMes(cuenta) > 0 ? html`<div class="positivo pequeno">≈ +${eur(interesesAlMes(cuenta))} al mes</div>` : ""}
                        </td>
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
          ${intereses > 0
            ? html`<p class="apagado pequeno">
                Con la TAE de cada cuenta, ganas unos ${eur(intereses)} al mes en intereses (antes del 19 % de IRPF). No hace falta apuntarlos: al actualizar el saldo ya están dentro.
              </p>`
            : ""}
        </section>
        ${tarjetaAportaciones(leerAportaciones(bd(estado)), historial(bd(estado)), {
          mes: mesDe(hoy),
          sugerido: ctx.resultado.presupuesto.objetivoAhorro,
          etapa: ctx.resultado.nombre,
          cuentas: activas,
          activos: leerActivos(bd(estado)).filter((a) => a.tipo !== "divisa"),
          hoy,
        })}
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

  app.post("/aportaciones", async (c) => {
    const f = await Formulario.de(c);
    const nombre = f.texto("nombre");
    const importe = f.importe("importe");
    const [tipo, id] = f.texto("destino").split(":");
    const dia = f.entero("dia") ?? 1;
    if (!nombre || !importe || importe <= 0 || !id || (tipo !== "c" && tipo !== "a")) return redirigir(c, "/cuentas#ahorro-automatico", { error: "Indica el nombre, el destino y el importe." });
    if (dia < 1 || dia > 31) return redirigir(c, "/cuentas#ahorro-automatico", { error: "El día tiene que estar entre 1 y 31." });
    bd(estado).ejecutar(
      "INSERT INTO aportaciones (nombre, cuenta_id, activo_id, importe, dia, inicio) VALUES (?, ?, ?, ?, ?, ?)",
      nombre,
      tipo === "c" ? Number(id) : null,
      tipo === "a" ? Number(id) : null,
      importe,
      dia,
      f.fecha("inicio") ?? estado.hoy(),
    );
    return redirigir(c, "/cuentas#ahorro-automatico", { ok: `Aportación «${nombre}» añadida. No cuenta como gasto: es ahorro.` });
  });

  app.post("/aportaciones/:id/terminar", (c) => {
    bd(estado).ejecutar("UPDATE aportaciones SET fin = ? WHERE id = ?", estado.hoy(), idDe(c));
    return redirigir(c, "/cuentas#ahorro-automatico", { ok: "Hecho: deja de contar desde hoy." });
  });

  app.get("/cierre", (c) => {
    const hoy = estado.hoy();
    const pedido = c.req.query("mes") ?? "";
    const mes = /^\d{4}-\d{2}$/.test(pedido) && pedido <= mesDe(hoy) ? pedido : sumarMesesAMes(mesDe(hoy), -1);
    const cuentas = leerCuentas(bd(estado), ultimoDia(mes));
    const yaCerrado = bd(estado).uno<{ mes: string }>("SELECT mes FROM cierres_mes WHERE mes = ?", mes);
    const delMes = leerAportaciones(bd(estado)).filter((a) => activaEn(a, mes));
    const hechas = historial(bd(estado));
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
                ${delMes.length
                  ? html`<fieldset>
                      <legend>Ahorro automático de ${nombreMes(mes)}</legend>
                      <p class="apagado pequeno">¿Se hizo cada aportación? Si un mes no la hiciste, pon 0: no pasa nada, solo se retrasa un poco tu objetivo.</p>
                      <div class="fila-campos">
                        ${delMes.map(
                          (a) => html`${campo({
                            etiqueta: `${a.nombre} (→ ${a.destino})`,
                            nombre: `aporte_${a.id}`,
                            valor: importeEditable(hechas.get(a.id)?.get(mes) ?? a.importe),
                            sufijo: "€",
                          })}
                          ${a.activoId ? campo({ etiqueta: "Participaciones compradas (opcional)", nombre: `cantidad_${a.id}`, sufijo: "", ayuda: "Si lo dejas vacío, se calculan con el último precio." }) : ""}`,
                        )}
                      </div>
                    </fieldset>`
                  : ""}
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
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || mes > mesDe(estado.hoy())) return redirigir(c, "/cierre", { error: "Mes no válido." });
    const cuentas = leerCuentas(bd(estado), ultimoDia(mes));
    const saldos = [];
    for (const cuenta of cuentas) {
      const saldo = f.importe(`saldo_${cuenta.id}`);
      if (saldo === null) return redirigir(c, `/cierre?mes=${mes}`, { error: `El saldo de «${cuenta.nombre}» no es un número.` });
      saldos.push({ cuentaId: cuenta.id, saldo });
    }
    const aportadas = leerAportaciones(bd(estado))
      .filter((a) => activaEn(a, mes))
      .map((a) => ({ id: a.id, importe: Math.max(f.importe(`aporte_${a.id}`) ?? a.importe, 0), cantidad: f.numero(`cantidad_${a.id}`) }));
    const aportaciones = registrarMes(bd(estado), mes, aportadas);
    const cierre = cerrarMes(bd(estado), mes, saldos);
    const partes = [
      cierre.ahorro_real === null
        ? `${nombreMes(mes)} cerrado. Es tu primer cierre: a partir del siguiente verás cuánto ahorras de verdad.`
        : `${nombreMes(mes)} cerrado: has ahorrado ${eurR(cierre.ahorro_real)} (previsto ${eurR(cierre.ahorro_plan)}).`,
    ];
    if (aportaciones.omitidas.length) {
      partes.push(
        `Este mes no hiciste: ${aportaciones.omitidas.map((a) => `${a.nombre} (${eurR(a.importe)})`).join(", ")}. No pasa nada por un mes: tu objetivo sigue igual y la fecha estimada se retrasa un poco.`,
      );
    }
    if (aportaciones.sinPrecio.length) partes.push(`No sé el precio de ${aportaciones.sinPrecio.join(", ")}: apunta la compra a mano en Inversiones.`);
    return redirigir(c, "/cuentas", { ok: partes.join(" ") });
  });
}
