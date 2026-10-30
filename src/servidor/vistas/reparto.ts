import { html } from "hono/html";
import type { Presupuesto } from "../../reglas/tipos.ts";
import { eurR, type Html } from "./comun.ts";

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
