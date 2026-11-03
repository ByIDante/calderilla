import { html } from "hono/html";
import { NOMBRE_ETAPA, type Etapa, type Presupuesto } from "../../reglas/tipos.ts";
import { eur, eurR, type Html } from "./comun.ts";

/** Reparto de los ingresos del mes en una barra (si gastas más de lo que ingresas, la barra es el total de gastos). */
export function barraReparto(p: Presupuesto): Html {
  const tramos = [
    { n: 1, nombre: "Esenciales", valor: p.esenciales },
    { n: 2, nombre: "No esenciales", valor: p.noEsenciales },
    { n: 3, nombre: "Ahorro", valor: Math.max(p.objetivoAhorro - p.paraMetas, 0) },
    { n: 4, nombre: "Metas", valor: p.paraMetas },
    { n: 5, nombre: "Ocio", valor: p.ocioPlan },
  ].filter((t) => t.valor > 0);
  return html`<div class="reparto" role="img" aria-label="Reparto de tus ingresos: ${tramos.map((t) => `${t.nombre} ${eurR(t.valor)}`).join(", ")}">
      ${tramos.map((t) => html`<span class="tramo tramo-${t.n}" style="flex-grow: ${t.valor}" title="${t.nombre}: ${eurR(t.valor)}"></span>`)}
    </div>
    <ul class="leyenda">
      ${tramos.map((t) => html`<li><span class="muestra tramo-${t.n}" aria-hidden="true"></span>${t.nombre} <b>${eurR(t.valor)}</b></li>`)}
    </ul>`;
}

/** Cuánto ocio llevas gastado del que tienes este mes, con un color que se entiende de un vistazo. */
export function medidorOcio(p: Presupuesto): Html {
  const disponible = p.ocio + p.ocioRemanente;
  const usado = disponible > 0 ? (p.ocioGastado / disponible) * 100 : p.ocioGastado > 0 ? 101 : 0;
  const estado =
    usado > 100
      ? { clase: "mal", icono: "×", texto: "Te has pasado del ocio de este mes." }
      : usado >= 75
        ? { clase: "atencion", icono: "!", texto: "Ojo: te queda poco ocio este mes." }
        : { clase: "bien", icono: "✓", texto: "Vas bien." };
  return html`<div class="medidor-ocio">
    <div class="tarjeta-cabecera" style="margin-bottom:0">
      <span><span class="aviso-icono estado-${estado.clase}" aria-hidden="true">${estado.icono}</span> ${estado.texto}</span>
      <span class="numero">${eurR(p.ocioGastado)} de ${eurR(disponible)}</span>
    </div>
    <div class="barra" role="progressbar" aria-label="Ocio gastado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(usado, 100))}">
      <div class="barra-relleno estado-${estado.clase}" style="width: ${Math.min(usado, 100).toFixed(1)}%"></div>
    </div>
  </div>`;
}

/** Un paso del cálculo del ocio. Los que no son `siempre` solo se enseñan si no son cero (metas, corrección…). */
export interface Paso {
  clave: string;
  texto: string;
  importe: number;
  nota?: string;
  /** Color de la barra de reparto que le corresponde */
  tramo?: number;
  siempre: boolean;
}

/** Cuánto pide ahorrar la regla de cada 100 € que sobran (sin la cuota liberada de un préstamo, que va entera a ahorro) */
export function ahorroDeCada100(p: Presupuesto): number {
  return p.sobrante > 0 ? Math.round(((p.ahorroRegla - p.cuotaLiberada) / Math.max(p.sobrante - p.cuotaLiberada, 1)) * 100) : 0;
}

/** De los ingresos a lo que te queda para ocio, paso a paso. Lo usan Ocio y la Calculadora. */
export function pasosOcio(p: Presupuesto, etapa: Etapa): Paso[] {
  const notaAhorro = [
    `${ahorroDeCada100(p)} € de cada 100 € que te sobran`,
    p.cuotaLiberada ? `más la cuota liberada de ${eurR(p.cuotaLiberada)}` : "",
    p.ahorroAutomatico && p.ahorroAutomatico <= p.ahorroRegla ? `tu ahorro automático cubre ${eurR(p.ahorroAutomatico)}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return [
    { clave: "ingresos", texto: "Ingresos al mes", importe: p.ingresos, siempre: true },
    { clave: "esenciales", texto: "− Gastos esenciales", importe: -p.esenciales, tramo: 1, siempre: true },
    { clave: "no-esenciales", texto: "− Gastos no esenciales", importe: -p.noEsenciales, tramo: 2, siempre: true },
    { clave: "sobra", texto: "= Te sobra", importe: p.sobrante, siempre: true },
    { clave: "ahorro", texto: `− Ahorro de la etapa «${NOMBRE_ETAPA[etapa]}»`, importe: -(p.ahorroRegla - p.paraMetas), nota: notaAhorro, tramo: 3, siempre: true },
    {
      clave: "ahorro-extra",
      texto: "− Lo que apartas de más",
      importe: -(p.objetivoAhorro - p.ahorroRegla),
      nota: `tu ahorro automático aparta ${eurR(p.ahorroAutomatico)}, más de lo que pide la regla: ese dinero ya no está para ocio`,
      tramo: 3,
      siempre: false,
    },
    { clave: "metas", texto: "− Para tus metas", importe: -p.paraMetas, tramo: 4, siempre: false },
    { clave: "ocio-previsto", texto: "= Ocio previsto", importe: p.ocioPlan, tramo: 5, siempre: true },
    { clave: "correccion", texto: "− Corrección por los cierres", importe: -p.correccion, nota: "ahorraste menos de lo previsto en 2 de los 3 últimos cierres", siempre: false },
    { clave: "remanente", texto: "+ Lo que te sobró del mes pasado", importe: p.ocioRemanente, siempre: false },
    { clave: "gastado", texto: "− Ya gastado en ocio este mes", importe: -p.ocioGastado, siempre: true },
    { clave: "queda", texto: "= Te queda", importe: p.ocioQueda, siempre: true },
  ];
}

/** Importe de un paso: los totales («= …») en negrita; lo que resta, apagado */
export function importePaso(paso: Paso): Html {
  const total = paso.texto.startsWith("=");
  const clase = paso.clave === "queda" ? (paso.importe < 0 ? "negativo" : "positivo") : total ? "" : "apagado";
  return html`<span class="${clase}">${total ? html`<b>${eur(paso.importe)}</b>` : eur(paso.importe)}</span>`;
}

/** El cálculo del ocio como tabla de una columna (pantalla de Ocio). */
export function tablaPasos(pasos: readonly Paso[]): Html {
  return html`<div class="tabla-contenedor"><table>
    <tbody>
      ${pasos
        .filter((paso) => paso.siempre || paso.importe !== 0)
        .map(
          (paso) => html`<tr class="${paso.texto.startsWith("=") ? "fila-total" : ""}">
            <td>
              ${paso.tramo ? html`<span class="muestra tramo-${paso.tramo}" aria-hidden="true"></span>` : ""}${paso.texto}${paso.nota ? html`<div class="apagado pequeno">${paso.nota}</div>` : ""}
            </td>
            <td class="numero">${importePaso(paso)}</td>
          </tr>`,
        )}
    </tbody>
  </table></div>`;
}
