import { html } from "hono/html";
import { formatoFecha } from "../../dominio/fechas.ts";
import type { PropuestaCategoria } from "../../servicios/categorias.ts";
import type { MovimientoCompartido, PropuestaDevolucion } from "../../servicios/compartidos.ts";
import { eur, type Html } from "./comun.ts";

/*
 * Movimientos: categorías propuestas por parecido y gastos compartidos (lo que te devuelven por Bizum), en la
 * lista y en la ficha de cada movimiento.
 */

type Categorias = readonly { id: number; nombre: string; tipo: string }[];

/** «Te propongo categoría»: cada grupo con su categoría (que puedes cambiar) y si crear la regla */
export function tarjetaCategoriasPropuestas(propuestas: readonly PropuestaCategoria[], categorias: Categorias, volver: string): Html | string {
  if (!propuestas.length) return "";
  return html`<section class="tarjeta" id="categorias-propuestas">
    <h2>Te propongo categoría para ${propuestas.reduce((n, p) => n + p.apunteIds.length, 0)} movimientos</h2>
    <p class="apagado">Ya pusiste categoría a otros con el mismo texto. Marca los que quieras y, si se repiten, crea la regla para que los siguientes se categoricen solos.</p>
    <form method="post" action="/movimientos/proponer-categorias" class="formulario">
      <input type="hidden" name="volver" value="${volver}" />
      <div class="tabla-contenedor">
        <table class="tabla-acciones tabla-apilable">
          <thead><tr><th class="m-elegir" aria-label="Marcar"></th><th>Movimientos</th><th>Categoría</th><th>Regla</th></tr></thead>
          <tbody>
            ${propuestas.map(
              (p, i) => html`<tr>
                <td class="m-elegir"><label class="elegir"><input type="checkbox" name="elegir" value="${i}" checked aria-label="Categorizar ${p.nombre}" /></label></td>
                <td>
                  <b>${p.nombre}</b> · ${p.apunteIds.length} sin categoría
                  <div class="apagado pequeno">«${p.ejemplo}» · otros ${p.apoyos} ya están en ${p.categoria}</div>
                  <input type="hidden" name="clave_${i}" value="${p.clave}" />
                </td>
                <td>
                  <select name="categoria_${i}" aria-label="Categoría para ${p.nombre}" class="entrada-corta">
                    ${categorias.map((c) => html`<option value="${c.id}" ${c.id === p.categoriaId ? html`selected` : ""}>${c.nombre}</option>`)}
                  </select>
                </td>
                <td>
                  ${p.regla
                    ? html`<label class="casilla-fila casilla-larga"><input type="checkbox" name="regla_${i}" value="1" checked /> Si contiene «${p.regla}»</label>`
                    : html`<span class="apagado pequeno">Sin texto común</span>`}
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <div class="botones"><button class="boton boton-principal" type="submit">Poner las categorías marcadas</button></div>
    </form>
  </section>`;
}

/** «Gastos compartidos»: cada gasto con los Bizums que parecen su devolución, para confirmarlos o descartarlos */
export function tarjetaCompartidos(propuestas: readonly PropuestaDevolucion[], volver: string): Html | string {
  if (!propuestas.length) return "";
  return html`<section class="tarjeta" id="compartidos">
    <h2>Gastos compartidos</h2>
    <p class="apagado">
      Parece que te devolvieron parte de estos gastos. Si es así, júntalos: el gasto contará solo lo tuyo (en el ocio y en el presupuesto) y las devoluciones dejarán
      de contar como ingresos. Desmarca las que no sean.
    </p>
    ${propuestas.map(
      (p) => html`<form method="post" action="/movimientos/compartidos" class="compartido">
        <input type="hidden" name="volver" value="${volver}" />
        <input type="hidden" name="gasto" value="${p.gasto.id}" />
        <p class="compartido-gasto">
          <b>${p.gasto.concepto}</b> · ${formatoFecha(p.gasto.fecha)} · pagaste ${eur(-p.gasto.importe)}
          <span class="apagado pequeno">→ te devolvieron ${eur(p.total)}: cuenta ${eur(Math.max(-p.gasto.importe - p.total, 0))}</span>
        </p>
        <ul class="lista-plana">
          ${p.entradas.map(
            (e) => html`<li>
              <label class="casilla-fila casilla-larga"><input type="checkbox" name="entradas" value="${e.id}" checked /> ${formatoFecha(e.fecha)} · ${e.concepto}</label>
              <span class="numero positivo">${eur(e.importe)}</span>
            </li>`,
          )}
        </ul>
        <div class="botones">
          <button class="boton boton-principal boton-pequeno" type="submit">Juntar</button>
          <button class="boton boton-pequeno" type="submit" name="no" value="1">No son devoluciones</button>
        </div>
      </form>`,
    )}
  </section>`;
}

/** En la ficha de un gasto: lo que te devolvieron (con «Separar») y cómo añadir otra devolución */
export function seccionDevolucionesGasto(gasto: MovimientoCompartido, devoluciones: readonly MovimientoCompartido[], cercanas: readonly MovimientoCompartido[], volver: string): Html {
  const devuelto = devoluciones.reduce((s, d) => s + d.importe, 0);
  return html`<section class="tarjeta" id="devoluciones">
    <h2>¿Te devolvieron parte?</h2>
    <p class="apagado">
      Si pagaste algo de varios (una cena, un regalo) y te devolvieron su parte, une aquí las devoluciones: este gasto contará solo lo tuyo y ellas no contarán
      como ingresos.
    </p>
    ${devoluciones.length
      ? html`<ul class="lista-plana bloque">
            ${devoluciones.map(
              (d) => html`<li>
                <span>${formatoFecha(d.fecha)} · ${d.concepto}</span>
                <span class="numero positivo">${eur(d.importe)}</span>
                <form method="post" action="/movimientos/${d.id}/separar" class="en-linea">
                  <input type="hidden" name="volver" value="${volver}" />
                  <button class="boton boton-pequeno" type="submit">Separar</button>
                </form>
              </li>`,
            )}
          </ul>
          <p>Pagaste ${eur(-gasto.importe)}, te devolvieron ${eur(devuelto)}: <b>cuenta ${eur(Math.max(-gasto.importe - devuelto, 0))}</b>.</p>`
      : ""}
    ${cercanas.length
      ? html`<form method="post" action="/movimientos/${gasto.id}/devoluciones" class="botones">
          <input type="hidden" name="volver" value="${volver}" />
          <select name="entrada" aria-label="Devolución que añadir" class="entrada-corta" required>
            <option value="" selected disabled>Añadir una devolución…</option>
            ${cercanas.map((e) => html`<option value="${e.id}">${formatoFecha(e.fecha)} · ${e.concepto.slice(0, 50)} · ${eur(e.importe)}</option>`)}
          </select>
          <button class="boton" type="submit">Añadir</button>
        </form>`
      : html`<p class="apagado pequeno">No hay entradas cerca de su fecha que puedan ser una devolución.</p>`}
  </section>`;
}

/** En la ficha de una entrada: de qué gasto es la devolución (o elegirlo) */
export function seccionDevolucionEntrada(gasto: MovimientoCompartido | null, cercanos: readonly MovimientoCompartido[], entradaId: number, volver: string): Html {
  return html`<section class="tarjeta" id="devoluciones">
    <h2>¿Es lo que te devolvieron de un gasto?</h2>
    ${gasto
      ? html`<p>Es la devolución de <b>${gasto.concepto}</b> (${formatoFecha(gasto.fecha)}, ${eur(-gasto.importe)}): no cuenta como ingreso y ese gasto cuenta menos.</p>
          <form method="post" action="/movimientos/${entradaId}/separar" class="botones">
            <input type="hidden" name="volver" value="${volver}" />
            <button class="boton" type="submit">Separar de ese gasto</button>
          </form>`
      : html`<p class="apagado">Si alguien te devuelve su parte de algo que pagaste tú, únelo a ese gasto: no contará como ingreso y el gasto contará solo lo tuyo.</p>
          ${cercanos.length
            ? html`<form method="post" action="/movimientos/${entradaId}/devolucion" class="botones">
                <input type="hidden" name="volver" value="${volver}" />
                <select name="gasto" aria-label="Gasto del que es la devolución" class="entrada-corta" required>
                  <option value="" selected disabled>Es la devolución de…</option>
                  ${cercanos.map((g) => html`<option value="${g.id}">${formatoFecha(g.fecha)} · ${g.concepto.slice(0, 50)} · ${eur(-g.importe)}</option>`)}
                </select>
                <button class="boton" type="submit">Unir</button>
              </form>`
            : html`<p class="apagado pequeno">No hay gastos cerca de su fecha.</p>`}`}
  </section>`;
}
