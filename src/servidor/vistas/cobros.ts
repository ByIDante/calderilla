import { html } from "hono/html";
import { nombreDelMes, nombreMes, type Mes } from "../../dominio/fechas.ts";
import { desgloseAnual, NOMBRE_FRECUENCIA, type DesgloseAnual } from "../../dominio/recurrencia.ts";
import type { RecurrenteCompleto } from "../../servicios/finanzas.ts";
import { casilla, campo, eur, eurR, grafico, porque, selector, type Html } from "./comun.ts";

/*
 * Pagas extra y cobros que no son uno al mes: el formulario de las pagas, y cómo cuentan en el presupuesto
 * (se reparten entre los 12 meses) frente a lo que se cobra de verdad cada mes.
 */

/** «¿Cuándo llega?»: los casos habituales y, si no, los meses que elijas */
export const CUANDO_PAGA: readonly (readonly [string, string, readonly number[] | null])[] = [
  ["jun-dic", "Junio y diciembre", [6, 12]],
  ["jul-dic", "Julio y diciembre", [7, 12]],
  ["trimestral", "Cada 3 meses (marzo, junio, septiembre y diciembre)", [3, 6, 9, 12]],
  ["bimestral", "Cada 2 meses (febrero, abril, junio, agosto, octubre y diciembre)", [2, 4, 6, 8, 10, 12]],
  ["elegir", "Elegir los meses", null],
];

/** Los meses de una opción de «¿Cuándo llega?» (null si hay que elegirlos) */
export function mesesDeOpcion(opcion: string): readonly number[] | null {
  return CUANDO_PAGA.find(([valor]) => valor === opcion)?.[2] ?? null;
}

/** La opción que corresponde a unos meses («elegir» si no es ninguna de las habituales) */
export function opcionDeMeses(meses: readonly number[]): string {
  return CUANDO_PAGA.find(([, , lista]) => lista && lista.join(",") === meses.join(","))?.[0] ?? "elegir";
}

/** «junio y diciembre», «todos los meses» */
export function nombreMeses(meses: readonly number[]): string {
  if (meses.length === 12) return "todos los meses";
  const nombres = meses.map(nombreDelMes);
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : (nombres[0] ?? "");
}

/** Campos de la paga extra `n`; dentro van las siguientes, que solo se ven si marcas «Añadir otra». */
function filaPaga(n: number, v: Record<string, string>): Html {
  const marcados = new Set((v[`paga_meses_${n}`] ?? "").split(","));
  return html`<div class="paga-extra">
    <p class="paga-extra-titulo">Paga extra ${n}</p>
    <div class="fila-campos">
      ${selector("¿Cuándo llega?", `paga_cuando_${n}`, CUANDO_PAGA.map(([valor, texto]) => [valor, texto] as const), v[`paga_cuando_${n}`] || "jun-dic")}
      ${campo({
        etiqueta: "Importe de cada paga",
        nombre: `paga_importe_${n}`,
        valor: v[`paga_importe_${n}`],
        sufijo: "€",
        marcador: "Como un cobro normal",
        ayuda: "Si lo dejas vacío, es lo mismo que un cobro normal (y sube cuando sube tu sueldo).",
      })}
      ${campo({ etiqueta: "Nombre (opcional)", nombre: `paga_nombre_${n}`, valor: v[`paga_nombre_${n}`], marcador: "De verano, de Navidad, de beneficios…" })}
    </div>
    <fieldset class="meses-paga" data-mostrar-si="campo-paga_cuando_${n}=elegir">
      <legend>Meses en que llega</legend>
      <div class="rejilla-meses">
        ${Array.from({ length: 12 }, (_, i) => i + 1).map(
          (mes) => html`<label class="casilla-fila"><input type="checkbox" name="paga_meses_${n}" value="${mes}" ${marcados.has(String(mes)) ? html`checked` : ""} /> ${nombreDelMes(mes)}</label>`,
        )}
      </div>
    </fieldset>
    ${n < 3
      ? html`${casilla("Añadir otra paga extra", `paga_otra_${n + 1}`, v[`paga_otra_${n + 1}`] === "1")}
          <div data-mostrar-si="campo-paga_otra_${n + 1}">${filaPaga(n + 1, v)}</div>`
      : ""}
  </div>`;
}

/** Solo en ingresos: «¿Cobras pagas extra?» y hasta 3 pagas, cada una con sus meses y su importe. */
export function camposPagas(v: Record<string, string>): Html {
  return html`<div data-mostrar-si="campo-tipo=ingreso">
    ${selector(
      "¿Cobras pagas extra?",
      "pagas",
      [
        ["", "No (o vienen prorrateadas en cada cobro)"],
        ["1", "Sí"],
      ],
      v.pagas,
      "Se reparten entre los 12 meses: con 14 pagas de 1.500 €, tu presupuesto cuenta 1.750 € todos los meses.",
    )}
    <fieldset data-mostrar-si="campo-pagas=1">
      <legend>Pagas extra</legend>
      ${filaPaga(1, v)}
    </fieldset>
  </div>`;
}

function nombrePaga(paga: DesgloseAnual["pagas"][number]): string {
  return paga.nombre ? `Paga extra «${paga.nombre}»` : "Paga extra";
}

/** «1.500 € × 12 cobros + 2 pagas extra de 1.500 € = 21.000 € al año» (en un gasto, «cargos») */
export function frasePresupuesto(d: DesgloseAnual, tipo: "ingreso" | "gasto"): string {
  const vez = tipo === "ingreso" ? "cobro" : "cargo";
  const partes = [
    `${eurR(d.importe)} × ${d.veces} ${d.veces === 1 ? vez : `${vez}s`}`,
    ...d.pagas.map((paga) => `${paga.meses.length} ${paga.meses.length === 1 ? "paga extra" : "pagas extra"} de ${eurR(paga.importe)}`),
  ];
  return `${partes.join(" + ")} = ${eurR(d.total)} al año, entre 12 meses.`;
}

/** ¿Hace falta explicar cómo cuenta? Solo si no es un importe al mes sin más. */
export function necesitaDesglose(r: RecurrenteCompleto): boolean {
  return r.frecuencia !== "mensual" || r.pagasExtra.length > 0;
}

/** Ficha de un ingreso o gasto: de dónde sale lo que cuenta cada mes. */
export function tarjetaDesglose(r: RecurrenteCompleto, hoy: string): Html {
  if (!necesitaDesglose(r) || r.prestamo) return html``;
  const d = desgloseAnual(r, r.versiones, hoy);
  const cobro = r.tipo === "ingreso" ? "cobro" : "cargo";
  return html`<section class="tarjeta">
    <h2>Cómo cuenta en tu presupuesto</h2>
    <ul class="lista-plana">
      <li>
        <span>Cada ${cobro}: ${eur(d.importe)} ${NOMBRE_FRECUENCIA[r.frecuencia]}${r.frecuencia === "catorcenal" ? " (dos meses al año llegan 3)" : ""}</span>
        <span class="numero">${d.veces} al año · ${eur(d.normal)}</span>
      </li>
      ${d.pagas.map(
        (paga) => html`<li>
          <span>${nombrePaga(paga)}: ${eur(paga.importe)} en ${nombreMeses(paga.meses)}</span>
          <span class="numero">${paga.meses.length} al año · ${eur(paga.total)}</span>
        </li>`,
      )}
      <li><span><b>Total al año</b></span><span class="numero"><b>${eur(d.total)}</b></span></li>
      <li><span><b>Cuenta cada mes</b> (el total entre 12)</span><span class="numero"><b>${eur(d.alMes)}</b></span></li>
    </ul>
    ${r.tipo === "ingreso"
      ? porque(
          d.pagas.length
            ? "Así tu ocio y tu ahorro no suben y bajan según el mes. Los meses de paga extra cobras más, pero ese dinero ya contaba repartido en tu presupuesto de todos los meses: no es dinero de más para gastar ese mes."
            : "Así tu presupuesto es igual todos los meses aunque unos meses cobres más veces que otros.",
        )
      : porque("Así vas apartando cada mes lo que necesitarás cuando llegue el cargo, y ese mes no te pilla.")}
  </section>`;
}

export interface MesCobros {
  mes: Mes;
  /** Lo que se cobra de verdad ese mes */
  real: number;
  /** Lo que cuenta en el presupuesto */
  presupuesto: number;
  notas: string[];
}

/** «Tus ingresos mes a mes»: lo que cobras de verdad frente a lo que cuenta tu presupuesto, los próximos 12 meses. */
export function tarjetaMesAMes(meses: readonly MesCobros[]): Html {
  if (!meses.length) return html``;
  return html`<section class="tarjeta" id="ingresos-mes-a-mes">
    <h2>Tus ingresos mes a mes</h2>
    <p class="apagado">
      Las pagas extra y los meses en que cobras más veces se reparten: tu presupuesto cuenta lo mismo cada mes. Los meses que cobras más, ese dinero ya contaba
      repartido en los demás; los que cobras menos, lo compensan esos.
    </p>
    ${grafico(
      "grafico-ingresos-mes",
      "Lo que cobras de verdad y lo que cuenta en tu presupuesto",
      {
        tipo: "bar",
        etiquetas: meses.map((m) => nombreMes(m.mes).replace(/ de \d+$/, "")),
        series: [
          { nombre: "Cobras de verdad", valores: meses.map((m) => m.real / 100) },
          { nombre: "Cuenta en tu presupuesto", valores: meses.map((m) => m.presupuesto / 100) },
        ],
      },
      html`<table>
        <thead><tr><th>Mes</th><th class="numero">Cobras</th><th class="numero">Cuenta</th></tr></thead>
        <tbody>${meses.map((m) => html`<tr><td>${nombreMes(m.mes)}</td><td class="numero">${eur(m.real)}</td><td class="numero">${eur(m.presupuesto)}</td></tr>`)}</tbody>
      </table>`,
    )}
    <div class="tabla-contenedor">
      <table class="tabla-apilable">
        <caption class="sr">Tus ingresos mes a mes</caption>
        <thead>
          <tr><th>Mes</th><th class="numero">Cobras de verdad</th><th class="numero">Cuenta en tu presupuesto</th><th class="numero">Diferencia</th></tr>
        </thead>
        <tbody>
          ${meses.map((m) => {
            const diferencia = m.real - m.presupuesto;
            return html`<tr>
              <td>${nombreMes(m.mes)}${m.notas.length ? html`<div class="apagado pequeno">${m.notas.join(" · ")}</div>` : ""}</td>
              <td class="numero">${eur(m.real)}</td>
              <td class="numero">${eur(m.presupuesto)}</td>
              <td class="numero ${diferencia > 0 ? "positivo" : diferencia < 0 ? "negativo" : ""}">${diferencia > 0 ? "+" : ""}${eur(diferencia)}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
  </section>`;
}
