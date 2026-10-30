import type { Hono } from "hono";
import { html } from "hono/html";
import { formatoNumero, numeroEditable } from "../../dominio/dinero.ts";
import { formatoFecha } from "../../dominio/fechas.ts";
import { NOMBRE_ETAPA, type Etapa } from "../../reglas/tipos.ts";
import { esEspeculativo, leerActivos, leerCartera, NOMBRE_RENTA, NOMBRE_TIPO_ACTIVO, tipoCambio, type Renta, type TipoActivo } from "../../servicios/cartera.ts";
import { esAhorro } from "../../servicios/cuentas.ts";
import { contexto } from "../../servicios/situacion.ts";
import { actualizarPrecios, cotizar, guardarCotizacion } from "../../precios/actualizar.ts";
import { buscarCoingecko, buscarYahoo, type ResultadoBusqueda } from "../../precios/fuentes.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { botonAccion, campo, casilla, cifra, eur, eurR, grafico, pct, porque, selector, vacio, type Html } from "../vistas/comun.ts";
import { listaAvisos, listaDesbloqueos, tarjetaEtapa } from "../vistas/escalera.ts";

const TIPOS = Object.entries(NOMBRE_TIPO_ACTIVO) as [TipoActivo, string][];
const RENTAS = Object.entries(NOMBRE_RENTA) as [Renta, string][];

function formularioMovimiento(activoId: number, hoy: string): Html {
  return html`<form method="post" action="/activos/${activoId}/movimiento" class="formulario">
    <div class="fila-campos">
      ${selector("Operación", "tipo", [["compra", "Compra / aportación"], ["venta", "Venta / reembolso"]], "compra")}
      ${campo({ etiqueta: "Fecha", nombre: "fecha", tipo: "date", valor: hoy, id: `fecha-mov-${activoId}` })}
      ${campo({ etiqueta: "Participaciones o unidades", nombre: "cantidad", sufijo: "", requerido: true, id: `cantidad-${activoId}` })}
      ${campo({ etiqueta: "Euros pagados o cobrados", nombre: "importe", sufijo: "€", requerido: true, ayuda: "Con comisiones incluidas.", id: `importe-${activoId}` })}
    </div>
    <div class="botones"><button class="boton boton-principal" type="submit">Apuntar</button></div>
  </form>`;
}

function formularioPrecio(activoId: number, moneda: string, hoy: string): Html {
  return html`<form method="post" action="/activos/${activoId}/precio" class="formulario">
    <div class="fila-campos">
      ${campo({ etiqueta: `Precio por unidad (${moneda})`, nombre: "precio", sufijo: moneda === "EUR" ? "€" : moneda, requerido: true, ayuda: "El valor liquidativo o la cotización.", id: `precio-${activoId}` })}
      ${campo({ etiqueta: "Fecha", nombre: "fecha", tipo: "date", valor: hoy, id: `fecha-precio-${activoId}` })}
    </div>
    <div class="botones"><button class="boton" type="submit">Guardar precio</button></div>
  </form>`;
}

export function rutasInversiones(app: Hono, estado: Estado) {
  app.get("/inversiones", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    const ctx = contexto(base, hoy);
    const r = ctx.resultado;
    const cartera = ctx.cartera.filter((p) => p.cantidad > 0 || p.coste > 0);
    const historial = base.todos<{ fecha: string; etapa: Etapa }>("SELECT fecha, etapa FROM historial_etapas ORDER BY id DESC LIMIT 12");
    const actualizados = base.leerMeta("precios_actualizados");

    // Exposición por moneda: cuentas de ahorro y cartera, en euros
    const porMoneda = new Map<string, number>();
    for (const cuenta of ctx.cuentas.filter(esAhorro)) {
      const porEuro = tipoCambio(base, cuenta.moneda, hoy) ?? 1;
      porMoneda.set(cuenta.moneda, (porMoneda.get(cuenta.moneda) ?? 0) + Math.round(cuenta.saldo / porEuro));
    }
    for (const posicion of cartera) porMoneda.set(posicion.activo.moneda, (porMoneda.get(posicion.activo.moneda) ?? 0) + posicion.valor);
    const totalMonedas = [...porMoneda.values()].reduce((s, v) => s + v, 0);
    const monedas = new Set([...ctx.cuentas.map((x) => x.moneda), ...cartera.map((p) => p.activo.moneda)].filter((m) => m !== "EUR"));

    const grupos: [string, number][] = [
      ["Bolsa (renta variable)", cartera.filter((p) => !esEspeculativo(p.activo) && p.activo.renta === "variable").reduce((s, p) => s + p.valor, 0)],
      ["Renta fija", cartera.filter((p) => !esEspeculativo(p.activo) && p.activo.renta === "fija").reduce((s, p) => s + p.valor, 0)],
      ["Monetario", cartera.filter((p) => !esEspeculativo(p.activo) && p.activo.renta === "monetario").reduce((s, p) => s + p.valor, 0)],
      ["Especulativo (cripto, divisas)", ctx.situacion.especulativo],
      ["Planes de pensiones", ctx.situacion.pensiones],
    ];
    const conValor = grupos.filter(([, v]) => v > 0);

    return render(
      c,
      estado,
      { titulo: "Inversiones", seccion: "inversiones" },
      html`
        ${listaAvisos(r)} ${tarjetaEtapa(r)}

        <div class="cifras">
          ${cifra("Liquidez libre", eurR(r.liquidezLibre), "sin lo apartado para gastos anuales y metas")}
          ${cifra("Tu fondo de emergencia", eurR(r.fondoObjetivo), `${r.fondoMeses} × ${eurR(ctx.situacion.esenciales)} de gastos esenciales`, "acento")}
          ${cifra("Invertido a largo plazo", eurR(ctx.situacion.largoPlazo), `objetivo: ${r.rentaVariableObjetivo} % en bolsa`)}
          ${cifra("Especulativo", eurR(ctx.situacion.especulativo), "cripto y divisas")}
        </div>
        <section class="tarjeta">
          <h2>Tu «cuánto es mucho»</h2>
          <p>
            Por debajo de <b>${eurR(r.fondoObjetivo)}</b> (${r.fondoMeses} meses de tus gastos esenciales) tu dinero va a una cuenta remunerada o un fondo monetario; por encima,
            se empieza a invertir. Esa cifra sube o baja sola si cambian tus gastos esenciales o la estabilidad de tus ingresos (Ajustes → Perfil).
          </p>
          ${porque(
            `Para decidir entre "dejarlo en una cuenta" o "invertir" no hay una cifra universal: depende de cuánto gastas y de lo seguro que es tu trabajo. Hoy, la mejor opción sin riesgo da ~${pct(r.rentabilidades.sinRiesgoNeta)} neto y la bolsa se espera, a largo plazo, ~${pct(r.rentabilidades.bolsaNeta)} neto (con caídas de hasta un 30–50 % por el camino).`,
          )}
        </section>

        <section class="bloque">
          <h2>Opciones</h2>
          <p class="apagado">Se desbloquean al llegar a la etapa «Invertir» y cumplir cada requisito.</p>
          ${listaDesbloqueos(r)}
        </section>

        <section class="tarjeta">
          <div class="tarjeta-cabecera">
            <h2>Tu cartera</h2>
            <span class="apagado pequeno">Valor total: ${eurR(cartera.reduce((s, p) => s + p.valor, 0))}</span>
          </div>
          <div class="botones bloque">
            ${botonAccion("/precios/actualizar", "Actualizar precios")}
            <span class="apagado pequeno">${actualizados ? `Últimos precios automáticos: ${new Date(actualizados).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` : "Los precios automáticos se actualizan solos cada 12 horas al abrir la app."}</span>
          </div>
          ${cartera.length
            ? html`<div class="tabla-contenedor">
                <table>
                  <thead><tr><th>Activo</th><th class="numero">Unidades</th><th class="numero">Precio</th><th class="numero">Valor</th><th class="numero">Ganancia</th></tr></thead>
                  <tbody>
                    ${cartera.map((p) => {
                      const ganancia = p.valor - p.coste;
                      return html`<tr>
                        <td>
                          <a href="/activos/${p.activo.id}">${p.activo.nombre}</a>
                          <div class="apagado pequeno">${[NOMBRE_TIPO_ACTIVO[p.activo.tipo], p.activo.isin, p.activo.moneda !== "EUR" ? p.activo.moneda : null, esEspeculativo(p.activo) ? "especulativo" : null].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td class="numero">${formatoNumero(p.cantidad)}</td>
                        <td class="numero">
                          ${p.precio ? `${formatoNumero(p.precio.precio)} ${p.activo.moneda === "EUR" ? "€" : p.activo.moneda}` : "—"}
                          <div class="apagado pequeno">${p.precio && p.activo.tipo !== "divisa" ? formatoFecha(p.precio.fecha) : ""}${p.sinPrecio ? "sin precio: se usa lo pagado" : ""}</div>
                        </td>
                        <td class="numero">${eur(p.valor)}</td>
                        <td class="numero ${ganancia >= 0 ? "positivo" : "negativo"}">${p.sinPrecio ? "—" : `${ganancia >= 0 ? "+" : ""}${eur(ganancia)}`}</td>
                      </tr>`;
                    })}
                  </tbody>
                </table>
              </div>`
            : vacio("Aún no tienes inversiones apuntadas.")}
          <details style="margin-top:12px">
            <summary class="boton">Añadir un activo</summary>
            <form method="post" action="/activos" class="formulario" style="margin-top:12px">
              <div class="fila-campos">
                ${campo({ etiqueta: "Nombre", nombre: "nombre", requerido: true, marcador: "Fondo indexado mundial, Bitcoin, dólares…" })}
                ${selector("Tipo", "tipo", TIPOS, "fondo")}
                ${selector("Qué es por dentro", "renta", RENTAS, "variable", "Para fondos y ETF: bolsa, renta fija o monetario.")}
              </div>
              <div class="fila-campos">
                ${campo({ etiqueta: "ISIN (opcional)", nombre: "isin", marcador: "IE00B03HCZ61" })} ${campo({ etiqueta: "Ticker (opcional)", nombre: "simbolo", marcador: "VWCE, BTC…" })}
                ${campo({ etiqueta: "Moneda", nombre: "moneda", valor: "EUR", ayuda: "La de su precio: EUR, USD…" })}
              </div>
              ${casilla("Es especulativo", "especulativo", false, "Cripto y divisas lo son siempre. Marca también aquí cualquier apuesta que podrías perder.")}
              <fieldset>
                <legend>Primera compra (opcional)</legend>
                <div class="fila-campos">
                  ${campo({ etiqueta: "Fecha", nombre: "fecha", tipo: "date", valor: hoy, id: "fecha-nuevo" })} ${campo({ etiqueta: "Unidades", nombre: "cantidad", sufijo: "", id: "cantidad-nuevo" })}
                  ${campo({ etiqueta: "Euros pagados", nombre: "importe", sufijo: "€", id: "importe-nuevo" })}
                  ${campo({ etiqueta: "Precio actual por unidad", nombre: "precio", sufijo: "", id: "precio-nuevo", ayuda: "En la moneda del activo." })}
                </div>
              </fieldset>
              <div class="botones"><button type="submit" class="boton boton-principal">Añadir</button></div>
            </form>
          </details>
        </section>

        <div class="rejilla">
          <section class="tarjeta">
            ${conValor.length
              ? grafico(
                  "grafico-reparto",
                  "Reparto de lo invertido",
                  { tipo: "bar", horizontal: true, etiquetas: conValor.map(([n]) => n), series: [{ nombre: "Valor", valores: conValor.map(([, v]) => v / 100) }] },
                  html`<table><tbody>${conValor.map(([n, v]) => html`<tr><td>${n}</td><td class="numero">${eur(v)}</td></tr>`)}</tbody></table>`,
                )
              : vacio("Cuando apuntes inversiones verás aquí su reparto.")}
          </section>
          <section class="tarjeta">
            <h2>Exposición por moneda</h2>
            ${totalMonedas > 0
              ? html`<ul class="lista-plana">
                  ${[...porMoneda]
                    .sort((a, b) => b[1] - a[1])
                    .map(([moneda, valor]) => html`<li><span>${moneda}</span><span class="numero">${eur(valor)} · ${pct((valor / totalMonedas) * 100, 1)}</span></li>`)}
                </ul>`
              : html`<p class="apagado">Sin datos todavía.</p>`}
            ${porque(
              "Un fondo indexado mundial en euros invierte en empresas de todo el mundo, sobre todo de EE. UU.: aunque cotice en euros, su valor depende en buena parte del dólar. Esta lista solo mira la moneda en la que cotiza cada cosa. Si te preocupa el dólar, existen versiones del mismo fondo con la divisa cubierta.",
            )}
            ${monedas.size
              ? html`<h3 style="margin-top:12px">Tipos de cambio</h3>
                  <ul class="lista-plana">
                    ${[...monedas].map((m) => html`<li><span>1 € =</span><span class="numero">${tipoCambio(base, m, hoy) ?? "—"} ${m}</span></li>`)}
                  </ul>
                  <form method="post" action="/tipos-cambio" class="botones" style="margin-top:8px">
                    <select name="moneda" aria-label="Moneda" style="max-width:110px">${[...monedas].map((m) => html`<option>${m}</option>`)}</select>
                    <input type="text" inputmode="decimal" name="por_euro" placeholder="1,08" aria-label="Unidades por euro" style="max-width:110px" />
                    <button class="boton boton-pequeno" type="submit">Guardar cambio de hoy</button>
                  </form>`
              : ""}
          </section>
        </div>

        <section class="tarjeta" style="margin-top:16px">
          <h2>Historial de etapas</h2>
          ${historial.length
            ? html`<ul class="lista-plana">${historial.map((h) => html`<li><span>${NOMBRE_ETAPA[h.etapa] ?? h.etapa}</span><span class="apagado">desde el ${formatoFecha(h.fecha)}</span></li>`)}</ul>`
            : html`<p class="apagado">Sin historial todavía.</p>`}
        </section>
      `,
    );
  });

  app.post("/activos", async (c) => {
    const f = await Formulario.de(c);
    const nombre = f.texto("nombre");
    const tipo = TIPOS.find(([t]) => t === f.texto("tipo"))?.[0];
    const renta = RENTAS.find(([t]) => t === f.texto("renta"))?.[0] ?? "variable";
    const moneda = (f.texto("moneda") || "EUR").toUpperCase();
    if (!nombre || !tipo) return redirigir(c, "/inversiones", { error: "Falta el nombre o el tipo del activo." });
    if (!/^[A-Z]{3}$/.test(moneda)) return redirigir(c, "/inversiones", { error: "La moneda son tres letras: EUR, USD…" });
    const base = bd(estado);
    const hoy = estado.hoy();
    const id = base.transaccion(() => {
      const { id } = base.ejecutar(
        "INSERT INTO activos (nombre, isin, simbolo, tipo, renta, moneda, especulativo) VALUES (?, ?, ?, ?, ?, ?, ?)",
        nombre,
        f.opcional("isin")?.toUpperCase() ?? null,
        f.opcional("simbolo")?.toUpperCase() ?? null,
        tipo,
        tipo === "accion" || tipo === "cripto" || tipo === "divisa" ? "variable" : renta,
        moneda,
        f.casilla("especulativo") || tipo === "cripto" || tipo === "divisa" ? 1 : 0,
      );
      const cantidad = f.numero("cantidad");
      const importe = f.importe("importe");
      if (cantidad && importe) base.ejecutar("INSERT INTO movimientos_cartera (activo_id, fecha, tipo, cantidad, importe) VALUES (?, ?, 'compra', ?, ?)", id, f.fecha("fecha") ?? hoy, cantidad, importe);
      const precio = f.numero("precio");
      if (precio) base.ejecutar("INSERT OR REPLACE INTO precios (activo_id, fecha, precio, fuente) VALUES (?, ?, ?, 'manual')", id, hoy, precio);
      return id;
    });
    if (tipo === "divisa") return redirigir(c, "/inversiones", { ok: `Añadido «${nombre}». Su valor sale del tipo de cambio.` });
    return redirigir(c, `/activos/${id}`, { ok: `Añadido «${nombre}». Si quieres que su precio se actualice solo, búscalo aquí abajo.` });
  });

  app.get("/activos/:id", async (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    const id = idDe(c);
    const activo = leerActivos(base, true).find((a) => a.id === id);
    if (!activo) return c.notFound();
    const posicion = leerCartera(base, hoy).find((p) => p.activo.id === id);
    const movimientos = base.todos<{ id: number; fecha: string; tipo: string; cantidad: number; importe: number }>(
      "SELECT id, fecha, tipo, cantidad, importe FROM movimientos_cartera WHERE activo_id = ? ORDER BY fecha DESC, id DESC",
      id,
    );
    const precios = base.todos<{ fecha: string; precio: number; fuente: string }>("SELECT fecha, precio, fuente FROM precios WHERE activo_id = ? ORDER BY fecha DESC LIMIT 10", id);
    const busqueda = c.req.query("buscar")?.trim() ?? "";
    let resultados: ResultadoBusqueda[] = [];
    let errorBusqueda: string | null = null;
    if (busqueda) {
      try {
        resultados = activo.tipo === "cripto" ? await buscarCoingecko(busqueda, estado.ajustes.coingeckoClave) : await buscarYahoo(busqueda);
      } catch (error) {
        errorBusqueda = `No se pudo buscar: ${(error as Error).message}`;
      }
    }
    const sugerencia = activo.isin ?? activo.simbolo ?? activo.nombre;
    return render(
      c,
      estado,
      { titulo: activo.nombre, seccion: "inversiones" },
      html`
        <p><a href="/inversiones">← Volver a inversiones</a></p>
        <div class="cifras">
          ${cifra("Unidades", formatoNumero(posicion?.cantidad ?? 0))} ${cifra("Pagado (coste medio)", eur(posicion?.coste ?? 0))}
          ${cifra("Valor", eur(posicion?.valor ?? 0), posicion?.sinPrecio ? "sin precio: se usa lo pagado" : undefined)}
        </div>
        <div class="rejilla">
          <section class="tarjeta"><h2>Apuntar una compra o venta</h2>${formularioMovimiento(id, hoy)}</section>
          ${activo.tipo === "divisa"
            ? html`<section class="tarjeta"><h2>Valor</h2><p class="apagado">Una divisa se valora con el tipo de cambio (en Inversiones → Exposición por moneda).</p></section>`
            : html`<section class="tarjeta"><h2>Actualizar el precio</h2>${formularioPrecio(id, activo.moneda, hoy)}</section>`}
        </div>
        ${activo.tipo === "divisa"
          ? ""
          : html`<section class="tarjeta" style="margin-top:16px">
              <h2>Precio automático</h2>
              ${activo.fuentePrecio === "manual"
                ? html`<p class="apagado">
                      Busca el activo por ISIN, ticker o nombre y elige el resultado correcto: su precio se actualizará solo. ${activo.tipo === "cripto" ? "Las criptomonedas se buscan en CoinGecko." : "Se busca en Yahoo Finance; algunos fondos españoles no aparecen y hay que seguir poniendo el valor liquidativo a mano."}
                    </p>
                    <form method="get" action="/activos/${id}" class="botones">
                      <input type="text" name="buscar" value="${busqueda || sugerencia}" aria-label="Buscar por ISIN, ticker o nombre" style="max-width:320px" />
                      <button class="boton" type="submit">Buscar</button>
                    </form>
                    ${errorBusqueda ? html`<p class="negativo">${errorBusqueda}</p>` : ""}
                    ${busqueda && !resultados.length && !errorBusqueda ? html`<p class="apagado">Sin resultados. Prueba con el ticker o el nombre, o deja el precio manual.</p>` : ""}
                    ${resultados.length
                      ? html`<ul class="lista-plana" style="margin-top:10px">
                          ${resultados.map(
                            (r) => html`<li>
                              <span>${r.nombre} <span class="apagado pequeno">${[r.simbolo, r.tipo, r.mercado].filter(Boolean).join(" · ")}</span></span>
                              ${botonAccion(`/activos/${id}/fuente`, "Usar este", { campos: { fuente: r.fuente, simbolo: r.simbolo } })}
                            </li>`,
                          )}
                        </ul>`
                      : ""}`
                : html`<p>
                      Se actualiza solo desde ${activo.fuentePrecio === "yahoo" ? "Yahoo Finance" : "CoinGecko"} (<code>${activo.simboloFuente}</code>). Si pones un precio a mano para un día, ese
                      día gana el tuyo.
                    </p>
                    ${botonAccion(`/activos/${id}/fuente/quitar`, "Volver a precio manual", { estilo: "enlace" })}`}
            </section>`}
        <section class="tarjeta" style="margin-top:16px">
          <h2>Movimientos</h2>
          ${movimientos.length
            ? html`<div class="tabla-contenedor"><table>
                <thead><tr><th>Fecha</th><th>Operación</th><th class="numero">Unidades</th><th class="numero">Euros</th><th></th></tr></thead>
                <tbody>
                  ${movimientos.map(
                    (m) => html`<tr>
                      <td>${formatoFecha(m.fecha)}</td><td>${m.tipo}</td><td class="numero">${formatoNumero(m.cantidad)}</td><td class="numero">${eur(m.importe)}</td>
                      <td>${botonAccion(`/movimientos/${m.id}/borrar`, "Borrar", { estilo: "enlace", confirmar: "¿Borrar este movimiento?", campos: { volver: String(id) } })}</td>
                    </tr>`,
                  )}
                </tbody>
              </table></div>`
            : vacio("Sin movimientos.")}
        </section>
        ${precios.length
          ? html`<section class="tarjeta">
              <h2>Últimos precios</h2>
              <ul class="lista-plana">${precios.map((p) => html`<li><span>${formatoFecha(p.fecha)} · ${p.fuente}</span><span class="numero">${numeroEditable(p.precio)} ${activo.moneda}</span></li>`)}</ul>
            </section>`
          : ""}
        <p>${botonAccion(`/activos/${id}/archivar`, "Archivar este activo", { estilo: "enlace", confirmar: "¿Archivar? Deja de contar en tu cartera." })}</p>
      `,
    );
  });

  app.post("/activos/:id/movimiento", async (c) => {
    const id = idDe(c);
    const f = await Formulario.de(c);
    const cantidad = f.numero("cantidad");
    const importe = f.importe("importe");
    if (!cantidad || cantidad <= 0 || importe === null || importe < 0) return redirigir(c, `/activos/${id}`, { error: "Indica las unidades y los euros." });
    const tipo = f.texto("tipo") === "venta" ? "venta" : "compra";
    bd(estado).ejecutar("INSERT INTO movimientos_cartera (activo_id, fecha, tipo, cantidad, importe) VALUES (?, ?, ?, ?, ?)", id, f.fecha("fecha") ?? estado.hoy(), tipo, cantidad, importe);
    return redirigir(c, `/activos/${id}`, { ok: "Movimiento apuntado." });
  });

  app.post("/activos/:id/precio", async (c) => {
    const id = idDe(c);
    const f = await Formulario.de(c);
    const precio = f.numero("precio");
    if (!precio || precio <= 0) return redirigir(c, `/activos/${id}`, { error: "Indica el precio." });
    bd(estado).ejecutar("INSERT OR REPLACE INTO precios (activo_id, fecha, precio, fuente) VALUES (?, ?, ?, 'manual')", id, f.fecha("fecha") ?? estado.hoy(), precio);
    return redirigir(c, `/activos/${id}`, { ok: "Precio guardado." });
  });

  app.post("/activos/:id/archivar", (c) => {
    bd(estado).ejecutar("UPDATE activos SET archivado = 1 WHERE id = ?", idDe(c));
    return redirigir(c, "/inversiones", { ok: "Activo archivado." });
  });

  app.post("/movimientos/:id/borrar", async (c) => {
    const volver = (await Formulario.de(c)).entero("volver");
    bd(estado).ejecutar("DELETE FROM movimientos_cartera WHERE id = ?", idDe(c));
    return redirigir(c, volver ? `/activos/${volver}` : "/inversiones", { ok: "Movimiento borrado." });
  });

  app.post("/activos/:id/fuente", async (c) => {
    const id = idDe(c);
    const f = await Formulario.de(c);
    const fuente = f.texto("fuente") === "coingecko" ? "coingecko" : "yahoo";
    const simbolo = f.texto("simbolo");
    const activo = leerActivos(bd(estado)).find((a) => a.id === id);
    if (!activo || !simbolo) return redirigir(c, `/activos/${id}`, { error: "Elige un resultado de la búsqueda." });
    bd(estado).ejecutar("UPDATE activos SET fuente_precio = ?, simbolo_fuente = ? WHERE id = ?", fuente, simbolo, id);
    try {
      const cotizacion = await cotizar({ fuentePrecio: fuente, simboloFuente: simbolo }, { hoy: estado.hoy(), coingeckoClave: estado.ajustes.coingeckoClave });
      if (cotizacion) guardarCotizacion(bd(estado), { id, fuentePrecio: fuente, moneda: activo.moneda }, cotizacion);
      return redirigir(c, `/activos/${id}`, { ok: cotizacion ? `Enlazado. Último precio: ${formatoNumero(cotizacion.precio)} ${cotizacion.moneda ?? ""}.` : "Enlazado, pero la fuente aún no da precio." });
    } catch (error) {
      return redirigir(c, `/activos/${id}`, { error: `Enlazado, pero no se pudo traer el precio ahora: ${(error as Error).message}` });
    }
  });

  app.post("/activos/:id/fuente/quitar", (c) => {
    const id = idDe(c);
    bd(estado).ejecutar("UPDATE activos SET fuente_precio = 'manual', simbolo_fuente = NULL WHERE id = ?", id);
    return redirigir(c, `/activos/${id}`, { ok: "El precio vuelve a ser manual." });
  });

  app.post("/precios/actualizar", async (c) => {
    const informe = await actualizarPrecios(() => bd(estado), { hoy: estado.hoy(), coingeckoClave: estado.ajustes.coingeckoClave });
    const resumen = informe.actualizados.length ? `Actualizado: ${informe.actualizados.join(", ")}.` : "No hay precios automáticos que actualizar.";
    return redirigir(c, "/inversiones", informe.errores.length ? { ok: resumen, error: informe.errores.join(" · ") } : { ok: resumen });
  });

  app.post("/tipos-cambio", async (c) => {
    const f = await Formulario.de(c);
    const moneda = f.texto("moneda").toUpperCase();
    const porEuro = f.numero("por_euro");
    if (!/^[A-Z]{3}$/.test(moneda) || !porEuro || porEuro <= 0) return redirigir(c, "/inversiones", { error: "Indica cuántas unidades de la moneda da 1 €." });
    bd(estado).ejecutar("INSERT OR REPLACE INTO tipos_cambio (fecha, moneda, por_euro, fuente) VALUES (?, ?, ?, 'manual')", estado.hoy(), moneda, porEuro);
    return redirigir(c, "/inversiones", { ok: `Guardado: 1 € = ${porEuro} ${moneda}.` });
  });
}
