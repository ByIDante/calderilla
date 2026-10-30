import { html } from "hono/html";
import { formatoFecha, nombreMesCorto } from "../../dominio/fechas.ts";
import type { PropuestaAhorro, PropuestaCargo, PropuestaEstimacion, PropuestaPrecio, Propuestas } from "../../servicios/periodicos.ts";
import { botonAccion, eur, eurR, vacio, type Html } from "./comun.ts";

/*
 * «Encontrado en tus movimientos»: lo que se repite, para añadirlo al presupuesto marcándolo. Las casillas y
 * campos de cada fila van al formulario de la barra de arriba (atributo form), como en Movimientos.
 */

const FORMULARIO = "aceptar-propuestas";

const CADA: Record<number, string> = { 1: "Cada mes", 2: "Cada 2 meses", 3: "Cada 3 meses", 6: "Cada 6 meses", 12: "Cada año" };

function marcar(id: string, texto: string): Html {
  return html`<label class="elegir"><input type="checkbox" name="ids" value="${id}" form="${FORMULARIO}" aria-label="Añadir ${texto}" /></label>`;
}

function ignorar(id: string): Html {
  return botonAccion("/gastos/detectar/ignorar", "Ignorar", { pequeno: true, mantenerPosicion: true, campos: { id } });
}

function veces(c: PropuestaCargo): string {
  const p = c.periodico;
  return p.veces === 1 ? `una vez, el ${formatoFecha(p.ultimo)}` : `${p.veces} veces, la última el ${formatoFecha(p.ultimo)}`;
}

function importe(c: PropuestaCargo): Html {
  const p = c.periodico;
  const subida = p.clase === "fijo" && p.escalones.length > 1 ? html`<div class="apagado pequeno">antes ${eur(p.escalones.at(-2)!.importe)}</div>` : "";
  const alMes = p.meses > 1 ? html`<div class="apagado pequeno">${eurR(p.mensual)} al mes</div>` : "";
  return html`${p.clase === "estimacion" ? "unos " : ""}${eur(p.importe)}${subida}${alMes}`;
}

/**
 * ¿Qué es? Un gasto nuevo, uno de los que ya tienes en esa categoría (si el importe casi coincide, viene
 * elegido) o, si es una transferencia mensual, tu ahorro hacia otra cuenta tuya.
 */
function queEs(c: PropuestaCargo, cuentas: Propuestas["cuentas"]): Html | string {
  const p = c.periodico;
  const puedeSerAhorro = p.tipo === "gasto" && p.canal === "transferencia" && p.clase === "fijo" && p.meses === 1 && cuentas.length > 0;
  if (!c.posibles.length && !puedeSerAhorro) return "";
  const sugerido = c.posibles.find((x) => x.sugerido);
  const nombres = c.posibles.map((x) => `«${x.nombre}»`).join(" o ");
  return html`<select name="como_${c.id}" form="${FORMULARIO}" aria-label="Qué es" class="entrada-corta">
      <option value="nuevo">${p.tipo === "gasto" ? "Es un gasto nuevo" : "Es un ingreso nuevo"}</option>
      ${c.posibles.map((x) => html`<option value="unir:${x.id}" ${x === sugerido ? html`selected` : ""}>Es mi «${x.nombre}»: unirlo</option>`)}
      ${puedeSerAhorro ? cuentas.map((cuenta) => html`<option value="ahorro:${cuenta.id}">Es ahorro: va a mi cuenta ${cuenta.nombre}</option>`) : ""}
    </select>
    ${c.posibles.length
      ? html`<div class="apagado pequeno">Si es tu ${nombres}, elígelo aquí arriba para no contarlo dos veces.</div>`
      : ""}`;
}

function filaCargo(c: PropuestaCargo, cuentas: Propuestas["cuentas"]): Html {
  const p = c.periodico;
  return html`<tr>
    <td class="m-elegir">${marcar(c.id, p.nombre)}</td>
    <td>
      ${c.accion === "vincular"
        ? html`<b>Es tu «${c.recurrente!.nombre}»</b>
            <div class="apagado pequeno">Se unen a él ${c.vinculables === 1 ? "su movimiento" : `sus ${c.vinculables} movimientos`} para no contarlos dos veces</div>`
        : html`<input type="text" name="nombre_${c.id}" value="${p.nombre}" form="${FORMULARIO}" aria-label="Nombre" class="entrada-corta" />
            ${queEs(c, cuentas)}
            ${p.tipo === "gasto"
              ? html`<label class="casilla-fila"><input type="checkbox" name="esencial_${c.id}" value="1" form="${FORMULARIO}" ${c.esencial ? html`checked` : ""} /> Esencial</label>`
              : ""}`}
      <div class="apagado pequeno">«${p.ejemplo}» · ${veces(c)}</div>
    </td>
    <td>${p.unico ? "¿Cada año?" : CADA[p.meses]}${p.clase === "estimacion" ? html`<div class="apagado pequeno">varía</div>` : ""}</td>
    <td class="numero">${importe(c)}</td>
    <td>${c.categoria ?? html`<span class="apagado">Sin categoría</span>`}</td>
    <td class="celda-boton">${ignorar(c.id)}</td>
  </tr>`;
}

function tablaCargos(titulo: string, explicacion: string, lista: readonly PropuestaCargo[], cuentas: Propuestas["cuentas"]): Html | string {
  if (!lista.length) return "";
  return html`<section class="tarjeta">
    <h2>${titulo}</h2>
    <p class="apagado">${explicacion}</p>
    <div class="tabla-contenedor">
      <table class="tabla-acciones tabla-apilable">
        <thead>
          <tr>
            <th class="m-elegir" aria-label="Añadir"></th><th>Qué</th><th>Frecuencia</th><th class="numero">Importe</th><th>Categoría</th><th></th>
          </tr>
        </thead>
        <tbody>${lista.map((c) => filaCargo(c, cuentas))}</tbody>
      </table>
    </div>
  </section>`;
}

function tablaAhorros(lista: readonly PropuestaAhorro[]): Html | string {
  if (!lista.length) return "";
  return html`<section class="tarjeta">
    <h2>Dinero que pasas a tus cuentas cada mes</h2>
    <p class="apagado">No es un gasto: es ahorro. Apuntado como ahorro automático, cuenta para lo que pide la regla y al cerrar el mes verás si se hizo.</p>
    <div class="tabla-contenedor">
      <table class="tabla-acciones tabla-apilable">
        <thead><tr><th class="m-elegir" aria-label="Añadir"></th><th>Traspaso</th><th class="numero">Cada mes</th><th></th></tr></thead>
        <tbody>
          ${lista.map(
            (a) => html`<tr>
              <td class="m-elegir">${marcar(a.id, `traspaso a ${a.destino.nombre}`)}</td>
              <td>
                ${a.origen ? `De ${a.origen} a ${a.destino.nombre}` : `A ${a.destino.nombre}`}
                <div class="apagado pequeno">${a.periodico.veces} veces, la última el ${formatoFecha(a.periodico.ultimo)}</div>
              </td>
              <td class="numero">${eur(a.periodico.importe)}</td>
              <td class="celda-boton">${ignorar(a.id)}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </section>`;
}

function tablaPrecios(lista: readonly PropuestaPrecio[]): Html | string {
  if (!lista.length) return "";
  return html`<section class="tarjeta">
    <h2>Precios que han cambiado</h2>
    <p class="apagado">Los dos últimos cargos ya no coinciden con lo que tienes apuntado. Si lo actualizas, los meses anteriores conservan el precio de antes.</p>
    <div class="tabla-contenedor">
      <table class="tabla-acciones tabla-apilable">
        <thead><tr><th class="m-elegir" aria-label="Actualizar"></th><th>Gasto</th><th class="numero">Antes</th><th class="numero">Ahora</th><th>Desde</th><th></th></tr></thead>
        <tbody>
          ${lista.map(
            (p) => html`<tr>
              <td class="m-elegir">${marcar(p.id, `el nuevo precio de ${p.recurrente.nombre}`)}</td>
              <td>${p.recurrente.nombre}</td>
              <td class="numero">${eur(p.antes)}</td>
              <td class="numero">${eur(p.ahora)}</td>
              <td>${formatoFecha(p.desde)}</td>
              <td class="celda-boton">${ignorar(p.id)}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </section>`;
}

function tablaEstimaciones(lista: readonly PropuestaEstimacion[], sinCategoria: number): Html | string {
  if (!lista.length && sinCategoria < 1000) return "";
  return html`<section class="tarjeta">
    <h2>Lo que gastas cada mes en cosas que varían</h2>
    <p class="apagado">
      El súper, la gasolina, la farmacia… no tienen un importe fijo, pero sí uno normal: lo de un mes típico de los últimos meses completos que has importado. Con
      él tu presupuesto (y tu ocio) se ajusta a lo que gastas de verdad.
    </p>
    ${lista.length
      ? html`<div class="tabla-contenedor">
          <table class="tabla-acciones tabla-apilable">
            <thead><tr><th class="m-elegir" aria-label="Añadir"></th><th>Categoría</th><th class="numero">Lo normal al mes</th><th>Cómo queda</th><th></th></tr></thead>
            <tbody>
              ${lista.map(
                (e) => html`<tr>
                  <td class="m-elegir">${marcar(e.id, `la estimación de ${e.categoria}`)}</td>
                  <td>
                    ${e.categoria}
                    <div class="apagado pequeno">${e.meses.map((m) => `${nombreMesCorto(m.mes)}: ${eurR(m.total)}`).join(" · ")}</div>
                  </td>
                  <td class="numero">${eurR(e.mensual)}</td>
                  <td>
                    ${e.actual
                      ? html`Cambia «${e.actual.nombre}» de ${eurR(e.actual.importe)} a ${eurR(e.mensual)} desde este mes`
                      : html`Se añade «${e.categoria}» a tus gastos ${e.esencial ? "esenciales" : "no esenciales"}`}
                  </td>
                  <td class="celda-boton">${ignorar(e.id)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
      : ""}
    ${sinCategoria >= 1000
      ? html`<p class="apagado pequeno">
          Además gastas unos ${eurR(sinCategoria)} al mes en movimientos sin categoría, que no entran en estas cuentas.
          <a href="/movimientos?categoria=sin">Ponles categoría</a> y vuelve aquí.
        </p>`
      : ""}
  </section>`;
}

export function vistaDetectar(p: Propuestas): Html {
  const explicacion = html`<p class="apagado">
    He buscado en tus movimientos importados lo que se repite: lo que te cobran cada mes o cada pocos meses, tu nómina, lo que pasas a tus otras cuentas y lo que gastas
    de media en cada categoría. Marca lo que quieras añadir a tu presupuesto: <b>nada se crea sin que lo confirmes</b>, y lo que ignores no vuelve a salir.
  </p>`;
  if (!p.total) {
    return html`${explicacion}
      <section class="tarjeta">
        ${vacio(
          "No he encontrado nada nuevo. Para reconocer algo mensual hacen falta al menos 3 cargos: cuantos más meses importes, mejor.",
          html`<a class="boton" href="/importar">Importar un extracto</a>`,
        )}
      </section>
      <p><a href="/gastos">← Volver a ingresos y gastos</a></p>`;
  }
  return html`${explicacion}
    <form id="${FORMULARIO}" method="post" action="/gastos/detectar" class="barra-masiva" data-mantener-posicion data-seleccion-masiva>
      <label class="elegir-todos"><input type="checkbox" data-marcar-todos /> Marcar todo (${p.total})</label>
      <span class="apagado pequeno" data-cuenta-marcados>Marca lo que quieras añadir</span>
      <div class="barra-masiva-accion"><button class="boton boton-principal boton-pequeno" type="submit">Añadir lo marcado</button></div>
    </form>
    ${tablaCargos(
      "Gastos que se repiten",
      "Cargos que llegan cada cierto tiempo. Si ya tienes ese gasto apuntado, se une a él; si no, se crea con su importe (y sus subidas de precio, sin tocar los meses pasados).",
      p.gastos,
      p.cuentas,
    )}
    ${tablaCargos("Ingresos que se repiten", "Tu nómina y otros ingresos que llegan cada cierto tiempo.", p.ingresos, p.cuentas)}
    ${tablaAhorros(p.ahorros)} ${tablaPrecios(p.precios)}
    ${tablaCargos(
      "Cargos sueltos que pueden ser anuales",
      "Solo los he visto una vez, pero parecen un seguro o un impuesto. Si es anual, añádelo: se reparte entre los meses para que no te pille por sorpresa.",
      p.anuales,
      p.cuentas,
    )}
    ${tablaEstimaciones(p.estimaciones, p.sinCategoria)}
    <p><a href="/gastos">← Volver a ingresos y gastos</a></p>`;
}
