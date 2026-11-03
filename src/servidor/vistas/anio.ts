import { html } from "hono/html";
import { nombreMes, nombreMesCorto } from "../../dominio/fechas.ts";
import type { Anio, CategoriaDelAnio } from "../../servicios/anual.ts";
import { cifra, eur, eurR, grafico, vacio, type Html } from "./comun.ts";

/*
 * Tu año en cifras: lo que entró y salió cada mes, por categorías y frente al año anterior.
 */

const conSigno = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${eurR(Math.abs(c))}`;

function navegacion(d: Anio, anioActual: number): Html {
  return html`<div class="botones bloque">
    ${d.primerAnio !== null && d.anio - 1 >= d.primerAnio ? html`<a class="boton boton-pequeno" href="/anio?anio=${d.anio - 1}">← ${d.anio - 1}</a>` : ""}
    ${d.anio < anioActual ? html`<a class="boton boton-pequeno" href="/anio?anio=${d.anio + 1}">${d.anio + 1} →</a>` : ""}
    <a class="boton boton-pequeno" href="/">Volver al Resumen</a>
  </div>`;
}

/** Más (o menos) que el año anterior en lo que salió: subir es malo */
function diferencia(c: CategoriaDelAnio): Html | string {
  if (c.anterior === null || c.comparable === null) return "";
  const cambio = c.comparable - c.anterior;
  if (!cambio) return html`<span class="apagado">igual</span>`;
  return html`<span class="${cambio > 0 ? "negativo" : "positivo"}">${conSigno(cambio)}</span>`;
}

export function vistaAnio(d: Anio, anioActual: number): Html {
  if (!d.mesesConDatos) {
    return html`${navegacion(d, anioActual)}
      ${vacio(`No hay movimientos de ${d.anio}. Cuando importes tus extractos o conectes el banco, aquí verás tu año mes a mes.`, html`<a class="boton" href="/importar">Importar un extracto</a>`)}`;
  }
  const quedo = d.ingresos - d.gastos;
  const tasa = d.ingresos > 0 ? Math.round((quedo / d.ingresos) * 100) : null;
  const c = d.comparacion;
  const mismos = c ? (c.meses.length === 1 ? `en ${nombreMes(c.meses[0]!)}` : `en los mismos ${c.meses.length} meses de ${d.anio - 1}`) : "";
  const conDatos = d.meses.filter((m) => m.conDatos);
  // Los meses de antes del primero con movimientos no se enseñan: no se sabe nada de ellos
  const meses = d.meses.slice(d.meses.findIndex((m) => m.conDatos));
  return html`
    ${navegacion(d, anioActual)}
    <div class="cifras">
      ${cifra("Entró", eurR(d.ingresos), c ? `${mismos}: ${eurR(c.antes.ingresos)}` : `en ${d.mesesConDatos} ${d.mesesConDatos === 1 ? "mes" : "meses"} con movimientos`)}
      ${cifra("Salió", eurR(d.gastos), c ? `${mismos}: ${eurR(c.antes.gastos)}` : `unos ${eurR(Math.round(d.gastos / d.mesesConDatos))} al mes`)}
      ${cifra("Te quedó", conSigno(quedo), tasa === null ? undefined : `el ${tasa} % de lo que entró`, quedo >= 0 ? "bien" : "mal")}
      ${cifra("En ocio", eurR(d.ocio), `unos ${eurR(Math.round(d.ocio / d.mesesConDatos))} al mes`)}
    </div>
    ${d.patrimonio
      ? html`<p>
          Tu patrimonio pasó de <b>${eurR(d.patrimonio.inicio)}</b> (cierre de ${nombreMes(d.patrimonio.desde)}) a <b>${eurR(d.patrimonio.fin)}</b> (cierre de
          ${nombreMes(d.patrimonio.hasta)}): <b class="${d.patrimonio.fin >= d.patrimonio.inicio ? "positivo" : "negativo"}">${conSigno(d.patrimonio.fin - d.patrimonio.inicio)}</b>.
        </p>`
      : ""}
    <section class="tarjeta">
      ${grafico(
        "grafico-anio",
        `Lo que entró y salió cada mes de ${d.anio}`,
        {
          tipo: "bar",
          etiquetas: meses.map((m) => nombreMesCorto(m.mes)),
          series: [
            { nombre: "Entró", valores: meses.map((m) => (m.conDatos ? m.ingresos / 100 : null)) },
            { nombre: "Salió", valores: meses.map((m) => (m.conDatos ? m.gastos / 100 : null)) },
          ],
        },
        html`<table>
          <thead><tr><th>Mes</th><th class="numero">Entró</th><th class="numero">Salió</th><th class="numero">Te quedó</th><th class="numero">En ocio</th></tr></thead>
          <tbody>
            ${meses.map((m) =>
              m.conDatos
                ? html`<tr><td>${nombreMes(m.mes)}</td><td class="numero">${eur(m.ingresos)}</td><td class="numero">${eur(m.gastos)}</td><td class="numero">${eur(m.ingresos - m.gastos)}</td><td class="numero">${eur(m.ocio)}</td></tr>`
                : html`<tr><td>${nombreMes(m.mes)}</td><td colspan="4" class="apagado">Sin movimientos</td></tr>`,
            )}
          </tbody>
        </table>`,
      )}
      ${meses.length < d.meses.length ? html`<p class="apagado pequeno">Antes de ${nombreMes(meses[0]!.mes)} no hay movimientos.</p>` : ""}
      ${conDatos.some((m) => m.ahorroReal !== null)
        ? html`<p class="apagado pequeno">
            En los cierres, lo que ahorraste de verdad (contando tus cuentas e inversiones):
            ${conDatos.filter((m) => m.ahorroReal !== null).map((m, i) => html`${i ? " · " : ""}${nombreMesCorto(m.mes)} ${eurR(m.ahorroReal!)}`)}.
          </p>`
        : ""}
    </section>
    <section class="tarjeta">
      <h2>En qué se fue</h2>
      <div class="tabla-contenedor">
        <table class="tabla-apilable">
          <thead>
            <tr>
              <th>Categoría</th><th class="numero">En ${d.anio}</th><th class="numero">De lo que salió</th><th class="numero">Al mes</th>
              ${c ? html`<th class="numero">Frente a ${d.anio - 1}</th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${d.categorias.map(
              (x) => html`<tr>
                <td>${x.nombre}</td>
                <td class="numero">${eur(x.total)}</td>
                <td class="numero">${d.gastos > 0 ? `${Math.round((x.total / d.gastos) * 100)} %` : "—"}</td>
                <td class="numero">${eur(Math.round(x.total / d.mesesConDatos))}</td>
                ${c ? html`<td class="numero">${diferencia(x)}</td>` : ""}
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${c
        ? html`<p class="apagado pequeno">
            «Frente a ${d.anio - 1}» compara lo de ${c.meses.map((m) => nombreMes(m).replace(` de ${d.anio - 1}`, "")).join(", ")} de los dos años: solo los meses con movimientos en
            ambos.
          </p>`
        : ""}
    </section>
    <p class="apagado pequeno">
      Sale de tus movimientos (apuntados, importados o del banco): si una cuenta no la importas, falta lo suyo. Los traspasos entre tus cuentas no cuentan, y de un
      gasto compartido cuenta solo lo tuyo.
    </p>
  `;
}
