import { html } from "hono/html";
import { formatoFecha, mesDe, nombreMes, nombreMesCorto, sumarMesesAMes } from "../../dominio/fechas.ts";
import type { Etapa, Presupuesto } from "../../reglas/tipos.ts";
import type { Contexto } from "../../servicios/situacion.ts";
import { aviso, cifra, claveAviso, eur, eurR, grafico, vacio, type Html } from "./comun.ts";
import type { PresupuestoMes } from "../../servicios/finanzas.ts";
import type { GastoMensual, LineaPresupuesto } from "../../servicios/presupuesto.ts";
import { listaAvisos, tarjetaEtapa } from "./escalera.ts";
import { barrasPresupuesto } from "./presupuesto.ts";
import { barraReparto, medidorOcio } from "./reparto.ts";

interface DatosResumen {
  ctx: Contexto;
  cierrePendiente: string | null;
  ocultos: ReadonlySet<string>;
  presupuesto: LineaPresupuesto[];
  proximos: { nombre: string; fecha: string; importe: number }[];
  cierres: { etiqueta: string; plan: number; real: number | null; patrimonio: number }[];
  porCategoria: [string, number][];
  gastoMeses: GastoMensual;
  /** Lo que traspasas cada mes a otra cuenta o a un fondo (Cuentas → Ahorro automático) */
  automatico: number;
  ultimoCierre: { mes: string; plan: number; real: number | null } | null;
  /** Cosas que se repiten en tus movimientos y aún no están en el presupuesto */
  propuestas: number;
}

/** A qué va el ahorro que pide cada etapa de la escalera */
const DESTINO_ETAPA: Record<Etapa, string> = {
  deficit: "cuadrar tus gastos",
  colchon: "tu colchón",
  deuda_cara: "pagar antes tu deuda cara",
  fondo_emergencia: "tu fondo de emergencia",
  metas_corto: "tus metas cercanas",
  invertir: "invertir",
};

/** Lo esencial del mes en una frase: cuánto toca ahorrar y cuánto hay para ocio, y de dónde sale. */
function tarjetaMes(p: Presupuesto, etapa: Etapa, automatico: number, ultimoCierre: DatosResumen["ultimoCierre"]): Html {
  if (p.sobrante < 0) {
    return html`<section class="tarjeta tarjeta-mes">
      <h2>Tu mes en claro</h2>
      <p class="frase-mes">Este mes gastas <b class="negativo">${eurR(-p.sobrante)} más de lo que ingresas</b>: no queda nada para ahorrar ni para ocio.</p>
      ${barraReparto(p)}
      <p class="apagado">Empieza por <a href="/gastos">revisar tus gastos</a>, primero los no esenciales.</p>
    </section>`;
  }
  const ocioDelMes = p.ocio + p.ocioRemanente;
  const paraEtapa = p.objetivoAhorro - p.paraMetas;
  const destino = [p.paraMetas ? `${eurR(p.paraMetas)} para tus metas` : "", paraEtapa > 0 ? `${eurR(paraEtapa)} para ${DESTINO_ETAPA[etapa]}` : ""].filter(Boolean).join(" y ");
  const comoApartarlo =
    automatico <= 0
      ? html`Apártalo nada más cobrar, mejor con una transferencia periódica (<a href="/cuentas#ahorro-automatico">ahorro automático</a>).`
      : automatico >= p.objetivoAhorro
        ? html`Tu ahorro automático (${eurR(automatico)} al mes) ya lo cubre.`
        : html`Tu ahorro automático ya aparta ${eurR(automatico)}: aparta tú los otros ${eurR(p.objetivoAhorro - automatico)}.`;
  const notasOcio = [
    p.ocioRemanente ? `Incluye ${eurR(p.ocioRemanente)} que te sobraron el mes pasado.` : "",
    p.correccion ? `Lleva ${eurR(p.correccion)} menos porque en tus últimos cierres ahorraste menos de lo previsto.` : "",
  ].filter(Boolean);
  return html`<section class="tarjeta tarjeta-mes">
    <h2>Tu mes en claro</h2>
    <p class="frase-mes">
      ${p.objetivoAhorro > 0
        ? html`Este mes toca ahorrar <b>${eurR(p.objetivoAhorro)}</b> y tienes <b>${eurR(ocioDelMes)}</b> para ocio.`
        : html`Este mes no da para ahorrar: lo que te sobra, <b>${eurR(ocioDelMes)}</b>, es tu ocio.`}
    </p>
    ${barraReparto(p)}
    <div class="rejilla">
      <div>
        <h3>Ahorro: ${eurR(p.objetivoAhorro)}</h3>
        ${p.objetivoAhorro > 0 ? html`<p>${destino ? `${destino[0]!.toUpperCase()}${destino.slice(1)}. ` : ""}${comoApartarlo}</p>` : ""}
        <p class="apagado pequeno">
          ${ultimoCierre && ultimoCierre.real !== null
            ? html`En ${nombreMes(ultimoCierre.mes)} ahorraste de verdad
                <b class="${ultimoCierre.real < ultimoCierre.plan ? "negativo" : "positivo"}">${eurR(ultimoCierre.real)}</b> de ${eurR(ultimoCierre.plan)} previstos.`
            : html`Cuando cierres un mes verás aquí cuánto ahorraste de verdad.`}
        </p>
      </div>
      <div>
        <h3>${p.ocioQueda < 0 ? `Ocio: te has pasado ${eurR(-p.ocioQueda)}` : `Ocio: te quedan ${eurR(p.ocioQueda)}`}</h3>
        ${medidorOcio(p)}
        <p class="apagado pequeno">${notasOcio.join(" ")} <a href="/ocio">Cómo se calcula</a></p>
      </div>
    </div>
  </section>`;
}

/** Botones para ir al mes anterior o al siguiente (sin pasar del actual). */
function navegacionMes(mes: string, hoy: string): Html {
  const anterior = sumarMesesAMes(mes, -1);
  const siguiente = sumarMesesAMes(mes, 1);
  const actual = mesDe(hoy);
  return html`<div class="botones bloque">
    <a class="boton boton-pequeno" href="/?mes=${anterior}">← ${nombreMes(anterior)}</a>
    ${mes < actual ? html`<a class="boton boton-pequeno" href="${siguiente === actual ? "/" : `/?mes=${siguiente}`}">${nombreMes(siguiente)} →</a>` : ""}
  </div>`;
}

function tablaCategorias(filas: readonly [string, number][]): Html {
  return html`<table>
    <thead><tr><th>Categoría</th><th class="numero">Al mes</th></tr></thead>
    <tbody>${filas.map(([nombre, valor]) => html`<tr><td>${nombre}</td><td class="numero">${eur(valor)}</td></tr>`)}</tbody>
  </table>`;
}

/** Gasto por categoría mes a mes (barras apiladas, 5 categorías + «Otras»). */
function graficoGastoMeses(datos: GastoMensual): Html {
  const conDatos = datos.meses.map((_, i) => datos.series.some((s) => (s.valores[i] ?? 0) > 0));
  const primero = conDatos.indexOf(true);
  if (primero < 0 || conDatos.filter(Boolean).length < 2) return html``;
  const meses = datos.meses.slice(primero);
  const series = datos.series.map((s) => ({ nombre: s.nombre, valores: s.valores.slice(primero).map((v) => v / 100) }));
  return html`<section class="tarjeta" style="margin-top:16px">
    ${grafico(
      "grafico-gasto-meses",
      "Gasto por categoría, mes a mes (según tus movimientos)",
      { tipo: "bar", apilado: true, etiquetas: meses.map(nombreMesCorto), series },
      html`<table>
        <thead><tr><th>Categoría</th>${meses.map((m) => html`<th class="numero">${nombreMesCorto(m)}</th>`)}</tr></thead>
        <tbody>
          ${series.map((s) => html`<tr><td>${s.nombre}</td>${s.valores.map((v) => html`<td class="numero">${eur(Math.round(v * 100))}</td>`)}</tr>`)}
        </tbody>
      </table>`,
    )}
  </section>`;
}

export interface DatosMesPasado {
  mes: string;
  plan: PresupuestoMes;
  cierre: { ahorro_plan: number; ahorro_real: number | null; ocio_plan: number; ocio_gastado: number; etapa: string; patrimonio: number } | null;
  ocioGastado: number;
  gastos: [string, number][];
  hoy: string;
}

export function vistaMesPasado({ mes, plan, cierre, ocioGastado, gastos, hoy }: DatosMesPasado): Html {
  return html`
    ${navegacionMes(mes, hoy)}
    ${cierre ? "" : aviso("info", "Este mes no se cerró: no se sabe cuánto ahorraste de verdad. Lo de abajo es lo previsto y lo que hay en tus movimientos.", { ruta: `/cierre?mes=${mes}`, texto: "Cerrarlo ahora" })}
    <div class="cifras">
      ${cifra("Ingresos previstos", eurR(plan.ingresos))} ${cifra("Gastos fijos previstos", eurR(plan.esenciales + plan.noEsenciales))}
      ${cierre ? cifra("Ahorro", cierre.ahorro_real === null ? "—" : eurR(cierre.ahorro_real), `previsto: ${eurR(cierre.ahorro_plan)}`, cierre.ahorro_real !== null && cierre.ahorro_real < cierre.ahorro_plan ? "mal" : "bien") : ""}
      ${cifra("Ocio", eurR(cierre?.ocio_gastado ?? ocioGastado), cierre ? `de ${eurR(cierre.ocio_plan)} previstos` : "gastado")}
      ${cierre ? cifra("Patrimonio al cierre", eurR(cierre.patrimonio), `etapa: ${cierre.etapa}`) : ""}
    </div>
    <div class="rejilla">
      <section class="tarjeta">
        <h2>Lo que salió, por categoría</h2>
        ${gastos.length
          ? html`<div class="tabla-contenedor">${tablaCategorias(gastos)}</div>`
          : vacio("No hay movimientos apuntados ni importados de este mes.", html`<a class="boton" href="/importar">Importar un extracto</a>`)}
        <p><a href="/movimientos?mes=${mes}">Ver los movimientos de ${nombreMes(mes)}</a></p>
      </section>
      <section class="tarjeta">
        <h2>Gastos fijos de ese mes</h2>
        ${plan.lineas.filter((l) => l.recurrente.tipo === "gasto").length
          ? html`<ul class="lista-plana">
              ${plan.lineas
                .filter((l) => l.recurrente.tipo === "gasto")
                .sort((a, b) => b.mensual - a.mensual)
                .map((l) => html`<li><span>${l.recurrente.nombre}</span><span class="numero">${eur(l.mensual)}</span></li>`)}
            </ul>`
          : html`<p class="apagado">Ninguno.</p>`}
      </section>
    </div>
  `;
}

function avisoPropuestas(n: number, ocultos: ReadonlySet<string>): Html | string {
  if (!n) return "";
  const texto = `He encontrado ${n === 1 ? "algo que se repite" : `${n} cosas que se repiten`} en tus movimientos y aún no ${n === 1 ? "está" : "están"} en tu presupuesto: gastos fijos, tu nómina, lo que gastas de media…`;
  const clave = claveAviso(texto);
  return ocultos.has(clave) ? "" : aviso("info", texto, { ruta: "/gastos/detectar", texto: "Revisarlo" }, { clave });
}

function avisoCierre(mes: string | null, ocultos: ReadonlySet<string>): Html | string {
  if (!mes) return "";
  const texto = `Aún no has cerrado ${nombreMes(mes)}. Actualizar los saldos una vez al mes permite comparar lo que ahorras de verdad con lo previsto.`;
  const clave = claveAviso(texto);
  return ocultos.has(clave) ? "" : aviso("info", texto, { ruta: `/cierre?mes=${mes}`, texto: "Cerrar el mes" }, { clave });
}

export function vistaResumen({ ctx, cierrePendiente, ocultos, presupuesto, proximos, cierres, porCategoria, gastoMeses, automatico, ultimoCierre, propuestas }: DatosResumen): Html {
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
    ${navegacionMes(mesDe(ctx.hoy), ctx.hoy)} ${avisoCierre(cierrePendiente, ocultos)} ${avisoPropuestas(propuestas, ocultos)} ${listaAvisos(r, ocultos)}

    ${tarjetaMes(p, r.etapa, automatico, ultimoCierre)}

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

    ${graficoGastoMeses(gastoMeses)}

    ${presupuesto.some((l) => l.limite)
      ? html`<details class="tarjeta" style="margin-top:16px" open data-recordar-plegado="presupuesto-resumen">
          <summary><h2>Presupuesto por categorías</h2><a class="resumen-plegado" href="/movimientos#presupuesto">Ver movimientos</a></summary>
          ${barrasPresupuesto(presupuesto)}
        </details>`
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
