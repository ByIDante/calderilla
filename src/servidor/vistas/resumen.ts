import { html } from "hono/html";
import { formatoFecha, nombreMes } from "../../dominio/fechas.ts";
import type { Contexto } from "../../servicios/situacion.ts";
import { aviso, cifra, claveAviso, eur, eurR, grafico, vacio, type Html } from "./comun.ts";
import { listaAvisos, tarjetaEtapa } from "./escalera.ts";

interface DatosResumen {
  ctx: Contexto;
  cierrePendiente: string | null;
  ocultos: ReadonlySet<string>;
  proximos: { nombre: string; fecha: string; importe: number }[];
  cierres: { etiqueta: string; plan: number; real: number | null; patrimonio: number }[];
  porCategoria: [string, number][];
}

function avisoCierre(mes: string | null, ocultos: ReadonlySet<string>): Html | string {
  if (!mes) return "";
  const texto = `Aún no has cerrado ${nombreMes(mes)}. Actualizar los saldos una vez al mes permite comparar lo que ahorras de verdad con lo previsto.`;
  const clave = claveAviso(texto);
  return ocultos.has(clave) ? "" : aviso("info", texto, { ruta: `/cierre?mes=${mes}`, texto: "Cerrar el mes" }, { clave });
}

export function vistaResumen({ ctx, cierrePendiente, ocultos, proximos, cierres, porCategoria }: DatosResumen): Html {
  const r = ctx.resultado;
  const p = r.presupuesto;
  const sinDatos = ctx.recurrentes.length === 0 && ctx.cuentas.length === 0;

  if (sinDatos) {
    return html`<section class="tarjeta">
      <h2>Empieza en tres pasos</h2>
      <ol>
        <li><a href="/gastos/nuevo?tipo=ingreso">Apunta tu nómina</a> y otros ingresos fijos.</li>
        <li><a href="/gastos/nuevo">Apunta tus gastos fijos</a>: alquiler, suministros, el coche (con su préstamo), seguros anuales…</li>
        <li><a href="/cuentas">Añade tus cuentas</a> con su saldo actual.</li>
      </ol>
      <p class="apagado">Con eso, Calderilla calcula cuánto te sobra cada mes, cuánto puedes gastar en ocio y en qué etapa de la escalera de inversión estás.</p>
      <p class="apagado">Revisa también tu <a href="/ajustes">perfil</a> (estabilidad de ingresos y perfil de riesgo): cambia las recomendaciones.</p>
    </section>`;
  }

  return html`
    ${avisoCierre(cierrePendiente, ocultos)} ${listaAvisos(r, ocultos)}

    <div class="cifras">
      ${cifra("Ingresos al mes", eurR(p.ingresos))} ${cifra("Gastos esenciales", eurR(p.esenciales), "con préstamos y la parte mensual de los anuales")}
      ${cifra("Gastos no esenciales", eurR(p.noEsenciales))}
      ${cifra("Te sobra", eurR(p.sobrante), p.sobrante < 0 ? "gastas más de lo que ingresas" : `ahorro propuesto: ${eurR(p.objetivoAhorro)}`, p.sobrante < 0 ? "mal" : undefined)}
      ${cifra("Ocio: te queda este mes", eurR(p.ocioQueda), `de ${eurR(p.ocio + p.ocioRemanente)} · llevas ${eurR(p.ocioGastado)}`, "acento")}
      ${cifra("Patrimonio", eurR(ctx.patrimonio), ctx.deuda ? `menos ${eurR(ctx.deuda)} de préstamos` : "cuentas, inversión y planes de pensiones")}
    </div>

    ${tarjetaEtapa(r, { ruta: "/inversiones", texto: "Ver opciones de inversión" })}

    <div class="rejilla">
      <section class="tarjeta">
        ${porCategoria.length
          ? grafico(
              "grafico-categorias",
              "Gastos fijos de este mes por categoría",
              { tipo: "bar", horizontal: true, etiquetas: porCategoria.map(([nombre]) => nombre), series: [{ nombre: "Gasto al mes", valores: porCategoria.map(([, v]) => v / 100) }] },
              html`<table>
                <thead><tr><th>Categoría</th><th class="numero">Al mes</th></tr></thead>
                <tbody>${porCategoria.map(([nombre, valor]) => html`<tr><td>${nombre}</td><td class="numero">${eur(valor)}</td></tr>`)}</tbody>
              </table>`,
            )
          : vacio("Aún no hay gastos fijos apuntados.")}
      </section>
      <section class="tarjeta">
        ${cierres.length
          ? grafico(
              "grafico-cierres",
              "Ahorro previsto y real en cada cierre",
              {
                tipo: "bar",
                etiquetas: cierres.map((c) => c.etiqueta),
                series: [
                  { nombre: "Previsto", valores: cierres.map((c) => c.plan / 100) },
                  { nombre: "Real", valores: cierres.map((c) => (c.real === null ? null : c.real / 100)) },
                ],
              },
              html`<table>
                <thead><tr><th>Mes</th><th class="numero">Previsto</th><th class="numero">Real</th></tr></thead>
                <tbody>
                  ${cierres.map((c) => html`<tr><td>${c.etiqueta}</td><td class="numero">${eur(c.plan)}</td><td class="numero">${c.real === null ? "—" : eur(c.real)}</td></tr>`)}
                </tbody>
              </table>`,
            )
          : vacio("Cuando cierres tu primer mes verás aquí lo que ahorras de verdad frente a lo previsto.", html`<a class="boton" href="/cierre">Cerrar un mes</a>`)}
      </section>
    </div>

    ${cierres.length > 1
      ? html`<section class="tarjeta" style="margin-top:16px">
          ${grafico(
            "grafico-patrimonio",
            "Patrimonio al cierre de cada mes",
            { tipo: "line", etiquetas: cierres.map((c) => c.etiqueta), series: [{ nombre: "Patrimonio", valores: cierres.map((c) => c.patrimonio / 100) }] },
            html`<table>
              <tbody>${cierres.map((c) => html`<tr><td>${c.etiqueta}</td><td class="numero">${eur(c.patrimonio)}</td></tr>`)}</tbody>
            </table>`,
          )}
        </section>`
      : ""}

    <section class="tarjeta" style="margin-top:16px">
      <h2>Próximos cargos no mensuales</h2>
      ${proximos.length
        ? html`<ul class="lista-plana">
            ${proximos.map((x) => html`<li><span>${formatoFecha(x.fecha)} · ${x.nombre}</span><span class="numero">${eur(x.importe)}</span></li>`)}
          </ul>
          <p class="apagado pequeno">Ya están repartidos mes a mes en tus gastos: si has ido apartando esa parte, el dinero ya está.</p>`
        : html`<p class="apagado">Nada en los próximos 90 días.</p>`}
    </section>
  `;
}
