import { html } from "hono/html";
import { ETAPAS, NOMBRE_ETAPA, type Resultado } from "../../reglas/tipos.ts";
import { aviso, barra, eurR, porque, type Html } from "./comun.ts";

const CORTO: Record<(typeof ETAPAS)[number], string> = {
  deficit: "Cuadrar gastos",
  colchon: "Colchón",
  deuda_cara: "Deuda cara",
  fondo_emergencia: "Fondo de emergencia",
  metas_corto: "Metas cercanas",
  invertir: "Invertir",
};

export function peldanos(r: Resultado): Html {
  return html`<ol class="escalera" aria-label="Escalera de inversión">
    ${ETAPAS.map((etapa, i) => {
      const clase = i < r.numero - 1 ? "peldano-hecho" : i === r.numero - 1 ? "peldano-actual" : "";
      const estado = i < r.numero - 1 ? "superada" : i === r.numero - 1 ? "actual" : "pendiente";
      return html`<li class="peldano ${clase}" ${i === r.numero - 1 ? html`aria-current="step"` : ""}>
        <b>${i < r.numero - 1 ? "✓ " : ""}${i + 1}. ${CORTO[etapa]}</b><span class="sr">(${estado})</span>
      </li>`;
    })}
  </ol>`;
}

export function tarjetaEtapa(r: Resultado, enlace?: { ruta: string; texto: string }): Html {
  return html`<section class="tarjeta" aria-labelledby="titulo-etapa">
    <div class="tarjeta-cabecera">
      <h2 id="titulo-etapa">Tu escalera de inversión</h2>
      ${enlace ? html`<a href="${enlace.ruta}">${enlace.texto}</a>` : ""}
    </div>
    ${peldanos(r)}
    <p class="apagado pequeno" style="margin:0">Etapa ${r.numero} de ${ETAPAS.length}</p>
    <p class="etapa-nombre">${NOMBRE_ETAPA[r.etapa]}</p>
    ${r.progreso
      ? html`${barra(r.progreso.actual, r.progreso.objetivo, "Progreso de la etapa")}
          <p class="apagado pequeno" style="margin-top:0">
            ${eurR(r.progreso.actual)} de ${eurR(r.progreso.objetivo)}${r.progreso.meses ? html` · al ritmo actual, en unos ${r.progreso.meses} ${r.progreso.meses === 1 ? "mes" : "meses"}` : ""}
            ${r.etapa === "invertir" ? html` · hasta desbloquear la parte especulativa` : ""}
          </p>`
      : ""}
    <div>
      ${r.acciones.length
        ? r.acciones.map((a) => html`<div class="accion"><p>${a.texto}</p>${porque(a.porque)}</div>`)
        : html`<p class="apagado">Apunta tus ingresos, gastos y saldos para que la regla pueda sugerirte algo.</p>`}
    </div>
    <p class="apagado pequeno">${r.siguiente}</p>
    <details class="porque">
      <summary>¿Y si un mes no puedo ahorrar lo previsto?</summary>
      <p>
        No pasa nada. La escalera mira tus saldos reales cada vez que los actualizas: el objetivo sigue igual y la fecha estimada se retrasa. No hace falta recuperarlo
        al mes siguiente. Solo si en 2 de los 3 últimos cierres de mes ahorras menos de lo previsto, la app baja tu presupuesto de ocio hasta que cuadre.
      </p>
    </details>
  </section>`;
}

export function listaDesbloqueos(r: Resultado): Html {
  return html`<div class="opciones">
    ${r.desbloqueos.map(
      (d) => html`<article class="opcion ${d.disponible ? "" : "opcion-bloqueada"}">
        <h3>${d.titulo}<span class="etiqueta ${d.disponible ? "etiqueta-si" : "etiqueta-no"}">${d.disponible ? "Disponible" : "Bloqueada"}</span></h3>
        ${d.disponible ? html`<p>${d.texto}</p>` : html`<p><b>Para desbloquearla:</b> ${d.requisito}</p>`} ${porque(d.porque)}
      </article>`,
    )}
  </div>`;
}

export function listaAvisos(r: Resultado): Html {
  return html`${r.avisos.map((a) => aviso(a.nivel, a.texto))}`;
}
