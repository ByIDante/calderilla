import { html, raw } from "hono/html";
import { formatoNumero } from "../../dominio/dinero.ts";
import { formatoFecha, nombreMes, nombreMesCorto } from "../../dominio/fechas.ts";
import { ETIQUETA_FRECUENCIA, FRECUENCIAS, NOMBRE_FRECUENCIA } from "../../dominio/recurrencia.ts";
import { veredictoDeuda, type Veredicto } from "../../reglas/deuda.ts";
import { NOMBRE_ESTABILIDAD, NOMBRE_ETAPA, type Etapa } from "../../reglas/tipos.ts";
import { cambios, mesesSinIngresos, proyectar, type Base, type Hito, type ParametroPrueba, type Prueba, type ResultadoAdelanto, type Simulacion } from "../../servicios/calculadora.ts";
import type { RecurrenteCompleto } from "../../servicios/finanzas.ts";
import { necesitaDesglose } from "./cobros.ts";
import { campo, casilla, cifra, eur, eurR, grafico, porque, selector, type Html } from "./comun.ts";
import { barraReparto, importePaso, pasosOcio } from "./reparto.ts";

/*
 * La Calculadora: a un lado tus números (que puedes cambiar) y al otro lo que saldría, comparado con lo de
 * verdad. Cada cambio pide a /calculadora/resultado los resultados nuevos (htmx), sin guardar nada.
 */

export interface DatosCalculadora {
  base: Base;
  prueba: Prueba;
  real: Simulacion;
  simulada: Simulacion;
  /** Lo que ya traspasas solo cada mes (sale en el cálculo del ocio) */
  automatico: number;
}

type Valores = Record<string, string>;

/** Qué regla de «de cada 100 € que te sobran» usa cada etapa */
const PROPORCION_ETAPA: Partial<Record<Etapa, ParametroPrueba>> = {
  colchon: "proporcionColchon",
  deuda_cara: "proporcionDeuda",
  fondo_emergencia: "proporcionFondo",
  metas_corto: "proporcionMetas",
  invertir: "proporcionInvertir",
};

const FONDO_ESTABILIDAD = { estable: "fondoMesesEstable", normal: "fondoMesesNormal", inestable: "fondoMesesInestable" } as const;

/** Los botones «¿Y si…?» (qué hace cada uno: `aplicarRapido` en la ruta) */
const RAPIDOS = [
  ["sueldo", "Me suben el sueldo un 5 %"],
  ["precios", "Todo sube un 10 %"],
  ["no_esenciales", "Quito lo no esencial"],
  ["sin_ingresos", "Me quedo sin ingresos"],
] as const;

// ── Lo que se puede cambiar ──

/** «= 1.750 € al mes» al lado de cada línea, o «No cuenta» si la quitas */
function textoAlMes(d: DatosCalculadora, id: number): string {
  if (d.prueba.quitados.has(id)) return "No cuenta";
  const r = d.simulada.recurrentes.find((x) => x.id === id);
  if (!r || !necesitaDesglose(r)) return "";
  return `= ${eurR(d.simulada.presupuesto.lineas.find((l) => l.recurrente.id === id)?.mensual ?? 0)} al mes`;
}

function alMes(d: DatosCalculadora, id: number, oob = false): Html {
  return html`<span class="linea-al-mes" id="al-mes-${id < 0 ? `prueba-${-id}` : id}" ${oob ? raw('hx-swap-oob="true"') : ""}>${textoAlMes(d, id)}</span>`;
}

function filaLinea(r: RecurrenteCompleto, v: Valores, d: DatosCalculadora): Html {
  const id = r.id;
  const detalle = [r.categoria, r.clase === "estimacion" ? "estimación" : null, r.prestamo ? "préstamo: lo que debes no cambia" : null].filter(Boolean).join(" · ");
  const pagas = r.pagasExtra.reduce((suma, paga) => suma + paga.meses.length, 0);
  return html`<div class="linea-prueba ${r.prestamo ? "con-adelanto" : ""}">
    <label class="linea-nombre" for="importe-${id}">${r.nombre}${detalle ? html`<span class="apagado pequeno">${detalle}</span>` : ""}</label>
    <div class="entrada con-sufijo linea-importe">
      <input id="importe-${id}" name="importe_${id}" type="text" value="${v[`importe_${id}`] ?? ""}" inputmode="decimal" autocomplete="off" />
      <span class="sufijo">€</span>
    </div>
    <label class="casilla-fila linea-quitar"><input type="checkbox" name="quitar_${id}" value="1" ${v[`quitar_${id}`] === "1" ? html`checked` : ""} /> Quitar</label>
    <div class="linea-detalle">
      <span class="apagado">${NOMBRE_FRECUENCIA[r.frecuencia]}${pagas ? ` + ${pagas} ${pagas === 1 ? "paga extra" : "pagas extra"} al año` : ""}</span>
      ${alMes(d, id)}
    </div>
    ${r.prestamo
      ? html`<div class="linea-adelanto">
          <label for="adelantar-${id}">¿Y si adelantas</label>
          <div class="entrada con-sufijo">
            <input id="adelantar-${id}" name="adelantar_${id}" type="text" value="${v[`adelantar_${id}`] ?? ""}" inputmode="decimal" autocomplete="off" placeholder="0" />
            <span class="sufijo">€</span>
          </div>
          <select name="modo_${id}" aria-label="Qué reducir al adelantar">
            <option value="plazo">y acabas antes?</option>
            <option value="cuota" ${v[`modo_${id}`] === "cuota" ? html`selected` : ""}>y pagas menos al mes?</option>
          </select>
        </div>`
      : ""}
  </div>`;
}

function grupoLineas(titulo: string, lineas: readonly RecurrenteCompleto[], v: Valores, d: DatosCalculadora, vacioTexto: string): Html {
  return html`<h3>${titulo}</h3>
    ${lineas.length ? html`<div class="lineas-prueba">${lineas.map((r) => filaLinea(r, v, d))}</div>` : html`<p class="apagado pequeno">${vacioTexto}</p>`}`;
}

function filaNueva(n: number, v: Valores, d: DatosCalculadora): Html {
  return html`<div class="nuevo-prueba">
    <div class="fila-campos">
      ${selector(
        "Qué es",
        `nuevo_tipo_${n}`,
        [
          ["no_esencial", "Un gasto no esencial"],
          ["esencial", "Un gasto esencial"],
          ["ingreso", "Un ingreso"],
        ],
        v[`nuevo_tipo_${n}`],
      )}
      ${campo({ etiqueta: "Concepto", nombre: `nuevo_nombre_${n}`, valor: v[`nuevo_nombre_${n}`], marcador: n === 1 ? "Gimnasio, un piso más caro, un aumento…" : "" })}
      ${campo({ etiqueta: "Importe", nombre: `nuevo_importe_${n}`, valor: v[`nuevo_importe_${n}`], sufijo: "€" })}
      ${selector(
        "Cada cuánto",
        `nuevo_frecuencia_${n}`,
        FRECUENCIAS.map((f) => [f, ETIQUETA_FRECUENCIA[f]] as const),
        v[`nuevo_frecuencia_${n}`] || "mensual",
      )}
    </div>
    ${alMes(d, -n)}
  </div>`;
}

function filaMeta(meta: Base["situacion"]["metas"][number], v: Valores): Html {
  const id = meta.id!;
  return html`<fieldset class="meta-prueba">
    <legend>${meta.nombre}</legend>
    <div class="fila-campos">
      ${campo({ etiqueta: "Objetivo", nombre: `meta_objetivo_${id}`, valor: v[`meta_objetivo_${id}`], sufijo: "€" })}
      ${campo({ etiqueta: "Ya ahorrado", nombre: `meta_ahorrado_${id}`, valor: v[`meta_ahorrado_${id}`], sufijo: "€" })}
      ${campo({ etiqueta: "¿Para cuándo?", nombre: `meta_fecha_${id}`, valor: v[`meta_fecha_${id}`], tipo: "date" })}
    </div>
    ${casilla("Quitar esta meta", `quitar_meta_${id}`, v[`quitar_meta_${id}`] === "1")}
  </fieldset>`;
}

function reglas(d: DatosCalculadora, v: Valores): Html {
  const etapaActual = d.real.resultado.etapa;
  const estabilidad = d.base.situacion.perfil.estabilidad;
  const fondo = FONDO_ESTABILIDAD[estabilidad];
  const etapas = Object.entries(PROPORCION_ETAPA) as [Etapa, ParametroPrueba][];
  return html`<details class="tarjeta reglas-prueba" ${Object.keys(d.prueba.parametros).length ? html`open` : ""}>
    <summary><h2>Las reglas (avanzado)</h2></summary>
    <p class="apagado pequeno">Las de verdad se cambian en <a href="/ajustes/parametros">Ajustes → Parámetros</a>. Aquí solo es para probar.</p>
    <h3>De cada 100 € que te sobran, cuántos se ahorran en cada etapa</h3>
    <div class="fila-campos">
      ${etapas.map(([etapa, clave]) =>
        campo({ etiqueta: `${NOMBRE_ETAPA[etapa]}${etapa === etapaActual ? " (tu etapa)" : ""}`, nombre: `p_${clave}`, valor: v[`p_${clave}`], sufijo: "€" }),
      )}
    </div>
    <h3>Ocio mínimo</h3>
    <div class="fila-campos">
      ${campo({ etiqueta: "De cada 100 € que cobras, como mínimo", nombre: "p_ocioMinimoPct", valor: v.p_ocioMinimoPct, sufijo: "€" })}
      ${campo({ etiqueta: "Y nunca menos de", nombre: "p_ocioMinimoEur", valor: v.p_ocioMinimoEur, sufijo: "€" })}
    </div>
    <h3>Colchón y fondo de emergencia</h3>
    <div class="fila-campos">
      ${campo({ etiqueta: "Colchón mínimo", nombre: "p_colchonMinimo", valor: v.p_colchonMinimo, sufijo: "€" })}
      ${campo({
        etiqueta: "Fondo de emergencia: meses de gastos esenciales",
        nombre: `p_${fondo}`,
        valor: v[`p_${fondo}`],
        sufijo: "",
        ayuda: `Con tu estabilidad de ingresos: ${NOMBRE_ESTABILIDAD[estabilidad].toLowerCase()}.`,
      })}
    </div>
  </details>`;
}

/**
 * La página entera. El primer botón del formulario es un «Calcular» oculto: al pulsar Intro en un campo, el
 * navegador usa el primero, y no debe ser un «¿Y si…?». El formulario no hereda sus hx-* a lo de dentro: si
 * no, los enlaces («Volver a mis números») abrirían la página nueva dentro de la caja de resultados.
 */
export function vistaCalculadora(d: DatosCalculadora, v: Valores): Html {
  const lineas = d.base.presupuesto.lineas.map((l) => l.recurrente);
  const metas = d.base.situacion.metas.filter((meta) => meta.id !== undefined);
  return html`
    <p class="banda-prueba">
      <span class="aviso-icono" aria-hidden="true">i</span>
      <span><b>Solo para probar.</b> Nada de lo que cambies aquí se guarda ni cambia tus números. Cambia cualquier cifra y mira cómo quedaría.</span>
    </p>
    <div class="calculadora">
      <form
        class="calculadora-datos"
        method="get"
        action="/calculadora"
        hx-get="/calculadora/resultado"
        hx-target="#calculadora-resultado"
        hx-swap="outerHTML"
        hx-trigger="input delay:400ms, change, submit"
        hx-sync="this:replace"
        hx-disinherit="*"
      >
        <button type="submit" class="sr" tabindex="-1" aria-hidden="true">Calcular</button>
        <section class="tarjeta">
          <h2>¿Y si…?</h2>
          <div class="botones">
            ${RAPIDOS.map(
              ([valor, texto]) => html`<button
                type="submit"
                class="boton boton-pequeno"
                name="rapido"
                value="${valor}"
                formaction="/calculadora"
                hx-get="/calculadora"
                hx-include="closest form"
                hx-vals="${JSON.stringify({ rapido: valor })}"
                hx-target="#contenido"
                hx-select="#contenido"
                hx-swap="outerHTML"
              >
                ${texto}
              </button>`,
            )}
          </div>
          <p class="apagado pequeno">Se suman a lo que ya hayas cambiado. «Todo sube un 10 %» no toca las cuotas de los préstamos, que son fijas.</p>
        </section>
        <section class="tarjeta">
          <h2>Lo que entra y sale cada mes</h2>
          <p class="apagado pequeno">Cada importe es como lo cobras o lo pagas. Si no es una vez al mes, al lado ves lo que cuenta al mes.</p>
          ${grupoLineas("Lo que cobras", lineas.filter((r) => r.tipo === "ingreso"), v, d, "No tienes ingresos apuntados: añade uno de prueba abajo.")}
          ${grupoLineas("Gastos esenciales", lineas.filter((r) => r.tipo === "gasto" && r.esencial), v, d, "Ninguno.")}
          ${grupoLineas("Gastos no esenciales", lineas.filter((r) => r.tipo === "gasto" && !r.esencial), v, d, "Ninguno.")}
        </section>
        <section class="tarjeta">
          <h2>Añade algo para probar</h2>
          <p class="apagado pequeno">Por ejemplo: «¿y si me apunto al gimnasio por 40 € al mes?» o «¿y si me suben el sueldo?».</p>
          ${[1, 2, 3].map((n) => filaNueva(n, v, d))}
        </section>
        <section class="tarjeta">
          <h2>Lo que tienes</h2>
          <div class="fila-campos">
            ${campo({
              etiqueta: "Dinero en tus cuentas",
              nombre: "liquidez",
              valor: v.liquidez,
              sufijo: "€",
              ayuda: "Cuentas, efectivo y lo que puedes sacar pronto. Con esto se mira tu colchón y tu fondo de emergencia.",
            })}
            ${campo({ etiqueta: "Ya gastado en ocio este mes", nombre: "ocio_gastado", valor: v.ocio_gastado, sufijo: "€" })}
          </div>
        </section>
        <section class="tarjeta">
          <h2>Tus metas</h2>
          ${metas.length ? metas.map((meta) => filaMeta(meta, v)) : html`<p class="apagado pequeno">No tienes metas: prueba una aquí abajo.</p>`}
          <fieldset class="meta-prueba">
            <legend>Una meta de prueba</legend>
            <div class="fila-campos">
              ${campo({ etiqueta: "Para qué", nombre: "meta_nueva_nombre", valor: v.meta_nueva_nombre, marcador: "Un coche, un viaje…" })}
              ${campo({ etiqueta: "Objetivo", nombre: "meta_nueva_objetivo", valor: v.meta_nueva_objetivo, sufijo: "€" })}
              ${campo({ etiqueta: "Ya ahorrado", nombre: "meta_nueva_ahorrado", valor: v.meta_nueva_ahorrado, sufijo: "€" })}
              ${campo({ etiqueta: "¿Para cuándo?", nombre: "meta_nueva_fecha", valor: v.meta_nueva_fecha, tipo: "date" })}
            </div>
          </fieldset>
        </section>
        ${reglas(d, v)}
        <div class="botones">
          <button type="submit" class="boton boton-principal">Calcular</button>
          <a class="boton" href="/calculadora">Volver a mis números</a>
        </div>
      </form>
      ${resultadoCalculadora(d, { conLineas: false })}
    </div>
  `;
}

// ── Lo que saldría ──

type Mejor = "sube" | "baja" | null;

/** «▲ +100 €» en verde si te favorece, en rojo si no; «igual» si no cambia */
function diferencia(ahora: number | null, prueba: number | null, mejor: Mejor, formato: (n: number) => string): Html {
  if (ahora === null || prueba === null) return html`<span class="cambio">—</span>`;
  const d = prueba - ahora;
  // En euros redondos, menos de 50 céntimos se vería «+0 €»
  if (d === 0 || (formato === eurR && Math.abs(d) < 50)) return html`<span class="cambio">igual</span>`;
  const tono = mejor === null ? "" : (mejor === "sube") === d > 0 ? "cambio-bien" : "cambio-mal";
  return html`<span class="cambio ${tono}"><span aria-hidden="true">${d > 0 ? "▲" : "▼"}</span> ${d > 0 ? "+" : "−"}${formato(Math.abs(d))}</span>`;
}

const meses = (n: number) => `${formatoNumero(n)} ${n === 1 ? "mes" : "meses"}`;
/** Con un decimal, para comparar «4,6 meses» sin diferencias de milésimas */
const unDecimal = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

const VEREDICTO: Record<Veredicto, string> = {
  prioridad: "compensa: es deuda cara y pagarla es lo primero.",
  opcional: "es una opción, no una prioridad: te ahorras intereses, pero ese dinero también podría rendirte en otro sitio.",
  no: "no compensa: el préstamo es más barato que lo que te da el dinero sin riesgo.",
};

/** Lo que supone adelantar un préstamo: lo que pagas, lo que te ahorras, cómo queda y qué dice la regla */
function tarjetaAdelanto(a: ResultadoAdelanto, d: DatosCalculadora): Html {
  const regla = a.deuda ? veredictoDeuda(a.deuda, d.real.resultado.rentabilidades, d.simulada.parametros) : null;
  return html`<section class="tarjeta">
    <h2>Adelantar «${a.nombre}»</h2>
    <ul class="lista-plana">
      <li><span>Pagas hoy</span><span class="numero">${eur(a.importe)}${a.comision ? ` + ${eur(a.comision)} de comisión` : ""}</span></li>
      <li><span>Te ahorras de intereses</span><span class="numero positivo"><b>${eur(a.interesesAhorrados)}</b></span></li>
      ${a.comision ? html`<li><span>Contando la comisión</span><span class="numero">${eur(a.interesesAhorrados - a.comision)}</span></li>` : ""}
      ${a.modo === "plazo"
        ? html`<li><span>Terminas</span><span class="numero">${formatoFecha(a.finDespues)} <span class="apagado pequeno">antes ${formatoFecha(a.finAntes)}</span></span></li>`
        : html`<li><span>Cuota</span><span class="numero">${eur(a.cuotaDespues)} <span class="apagado pequeno">antes ${eur(a.cuotaAntes)}</span></span></li>`}
    </ul>
    ${a.vinculado ? html`<p class="negativo pequeno">Ojo: el precio dependía de mantener esta financiación. Si adelantas, podrías perder el descuento.</p>` : ""}
    ${regla ? html`<p><b>La regla:</b> ${VEREDICTO[regla.veredicto]}</p>${porque(regla.porque)}` : ""}
  </section>`;
}

/** Los próximos 2 años: lo que tendrías ahorrado y cuándo llegas a cada cosa, ahora y con la prueba */
function proyeccion(d: DatosCalculadora, conPrueba: boolean): Html {
  const ahora = proyectar(d.real);
  const prueba = conPrueba ? proyectar(d.simulada) : ahora;
  const cuando = (h: Hito | undefined) => (!h ? "—" : h.ya ? "Ya" : h.mes ? nombreMes(h.mes) : "Más de 2 años");
  const claves = [...new Set([...ahora.hitos, ...prueba.hitos].map((h) => h.clave))];
  const series = [
    { nombre: conPrueba ? "Ahora" : "Tus números", valores: ahora.puntos.map((p) => p.ahorrado / 100) },
    ...(conPrueba ? [{ nombre: "Con tu prueba", valores: prueba.puntos.map((p) => p.ahorrado / 100) }] : []),
  ];
  return html`<section class="tarjeta">
    <h2>En los próximos 2 años</h2>
    <p class="apagado pequeno" style="margin-top:0">Si cada mes ahorras lo que pide la regla. No cuenta intereses ni lo que haga la bolsa.</p>
    ${grafico(
      "grafico-proyeccion",
      "Lo que tendrías ahorrado",
      { tipo: "line", etiquetas: ahora.puntos.map((p) => nombreMesCorto(p.mes)), series },
      html`<table>
        <thead><tr><th>Mes</th>${series.map((serie) => html`<th class="numero">${serie.nombre}</th>`)}</tr></thead>
        <tbody>
          ${ahora.puntos.map(
            (punto, i) => html`<tr><td>${nombreMes(punto.mes)}</td>${series.map((serie) => html`<td class="numero">${eurR(Math.round(serie.valores[i]! * 100))}</td>`)}</tr>`,
          )}
        </tbody>
      </table>`,
    )}
    <h3>Cuándo llegas</h3>
    <div class="tabla-contenedor">
      <table class="tabla-apilable tabla-comparada" id="cuando-llegas">
        <caption class="sr">Cuándo llegas a cada cosa</caption>
        <thead><tr><th>Qué</th><th>Ahora</th>${conPrueba ? html`<th>Con tu prueba</th>` : ""}</tr></thead>
        <tbody>
          ${claves.map((clave) => {
            const a = ahora.hitos.find((h) => h.clave === clave);
            const b = prueba.hitos.find((h) => h.clave === clave);
            return html`<tr class="${conPrueba && cuando(a) !== cuando(b) ? "cambiado" : ""}" data-hito="${clave}">
              <td>${(b ?? a)!.nombre}</td>
              <td>${cuando(a)}</td>
              ${conPrueba ? html`<td><b>${cuando(b)}</b></td>` : ""}
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
  </section>`;
}

interface Comparada {
  etiqueta: string;
  donde: string;
  ahora: number | null;
  prueba: number | null;
  mejor: Mejor;
  formato?: (n: number) => string;
}

function cifraComparada(etiqueta: string, ahora: number, prueba: number, mejor: Mejor): Html {
  return cifra(etiqueta, eurR(prueba), html`Ahora ${eurR(ahora)} · ${diferencia(ahora, prueba, mejor, eurR)}`, prueba !== ahora ? "acento" : undefined);
}

function fraseEtapa(d: DatosCalculadora): Html {
  const a = d.real.resultado;
  const b = d.simulada.resultado;
  const nombre = (r: typeof a) => `${r.numero}. ${NOMBRE_ETAPA[r.etapa]}`;
  const progreso = b.progreso
    ? html` Objetivo: <b>${eurR(b.progreso.objetivo)}</b>${b.progreso.meses ? html`, al ritmo propuesto en unos <b>${meses(b.progreso.meses)}</b>` : ""}.`
    : "";
  if (a.etapa === b.etapa) return html`<p>Seguirías en la etapa <b>${nombre(b)}</b>.${progreso}</p>`;
  return html`<p class="etapa-cambia">
    ${b.numero > a.numero ? "Pasarías" : "Volverías"} de la etapa <b>${nombre(a)}</b> a la <b>${nombre(b)}</b>.${progreso}
  </p>`;
}

function tablaComparada(filas: readonly Comparada[]): Html {
  return html`<div class="tabla-contenedor">
    <table class="tabla-apilable tabla-comparada">
      <caption class="sr">Todas las cifras, ahora y con tu prueba</caption>
      <thead><tr><th>Cifra</th><th class="numero">Ahora</th><th class="numero">Con tu prueba</th><th class="numero">Diferencia</th></tr></thead>
      <tbody>
        ${filas.map((f) => {
          const formato = f.formato ?? eurR;
          const texto = (n: number | null) => (n === null ? "—" : formato(n));
          return html`<tr class="${f.ahora !== f.prueba ? "cambiado" : ""}">
            <td>${f.etiqueta}<div class="apagado pequeno">${f.donde}</div></td>
            <td class="numero">${texto(f.ahora)}</td>
            <td class="numero"><b>${texto(f.prueba)}</b></td>
            <td class="numero">${diferencia(f.ahora, f.prueba, f.mejor, formato)}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

/** El cálculo del ocio paso a paso, con tus números y con la prueba, fila a fila */
function tablaPasosComparada(d: DatosCalculadora): Html {
  const ahora = pasosOcio(d.real.resultado.presupuesto, d.real.resultado.etapa, d.automatico);
  const prueba = pasosOcio(d.simulada.resultado.presupuesto, d.simulada.resultado.etapa, d.automatico);
  return html`<div class="tabla-contenedor">
    <table class="tabla-apilable tabla-comparada">
      <caption class="sr">De dónde sale el ocio, ahora y con tu prueba</caption>
      <thead><tr><th>Paso</th><th class="numero">Ahora</th><th class="numero">Con tu prueba</th></tr></thead>
      <tbody>
        ${prueba
          .map((paso, i) => [ahora[i]!, paso] as const)
          .filter(([a, b]) => a.siempre || a.importe !== 0 || b.importe !== 0)
          .map(
            ([a, b]) => html`<tr class="${b.texto.startsWith("=") ? "fila-total" : ""} ${a.importe !== b.importe ? "cambiado" : ""}">
              <td>
                ${b.tramo ? html`<span class="muestra tramo-${b.tramo}" aria-hidden="true"></span>` : ""}${b.texto}${b.nota ? html`<div class="apagado pequeno">${b.nota}</div>` : ""}
              </td>
              <td class="numero">${importePaso(a)}${a.nota && a.nota !== b.nota ? html`<div class="apagado pequeno">${a.nota}</div>` : ""}</td>
              <td class="numero">${importePaso(b)}</td>
            </tr>`,
          )}
      </tbody>
    </table>
  </div>`;
}

/** Los resultados (y, al recalcular, el «al mes» de cada línea, que htmx coloca en su sitio). */
export function resultadoCalculadora(d: DatosCalculadora, opciones: { conLineas: boolean }): Html {
  const a = d.real.resultado;
  const b = d.simulada.resultado;
  const pa = a.presupuesto;
  const pb = b.presupuesto;
  const n = cambios(d.prueba);
  const filas: Comparada[] = [
    { etiqueta: "Ingresos al mes", donde: "Resumen", ahora: pa.ingresos, prueba: pb.ingresos, mejor: "sube" },
    { etiqueta: "Gastos al mes", donde: "Resumen", ahora: pa.esenciales + pa.noEsenciales, prueba: pb.esenciales + pb.noEsenciales, mejor: "baja" },
    { etiqueta: "Te sobra al mes", donde: "Resumen", ahora: pa.sobrante, prueba: pb.sobrante, mejor: "sube" },
    { etiqueta: "Toca ahorrar este mes", donde: "Resumen", ahora: pa.objetivoAhorro, prueba: pb.objetivoAhorro, mejor: "sube" },
    { etiqueta: "De eso, para tus metas", donde: "Resumen y Metas", ahora: pa.paraMetas, prueba: pb.paraMetas, mejor: null },
    { etiqueta: "Para ocio este mes", donde: "Resumen y Ocio", ahora: pa.ocio + pa.ocioRemanente, prueba: pb.ocio + pb.ocioRemanente, mejor: "sube" },
    { etiqueta: "Ocio mínimo", donde: "Ocio", ahora: pa.ocioMinimo, prueba: pb.ocioMinimo, mejor: null },
    { etiqueta: "Te queda para ocio", donde: "Resumen y Ocio", ahora: pa.ocioQueda, prueba: pb.ocioQueda, mejor: "sube" },
    { etiqueta: "Dinero libre", donde: "Inversiones · tus cuentas menos lo apartado", ahora: a.liquidezLibre, prueba: b.liquidezLibre, mejor: "sube" },
    { etiqueta: "Colchón que necesitas", donde: "Resumen e Inversiones", ahora: a.colchonObjetivo, prueba: b.colchonObjetivo, mejor: null },
    { etiqueta: "Fondo de emergencia que necesitas", donde: "Resumen e Inversiones", ahora: a.fondoObjetivo, prueba: b.fondoObjetivo, mejor: null },
    { etiqueta: "Meses para llegar al objetivo de tu etapa", donde: "Resumen", ahora: a.progreso?.meses ?? null, prueba: b.progreso?.meses ?? null, mejor: "baja", formato: meses },
    {
      etiqueta: "Si dejaras de cobrar, aguantarías",
      donde: "lo de tus cuentas entre tus gastos esenciales",
      ahora: unDecimal(mesesSinIngresos(d.real)),
      prueba: unDecimal(mesesSinIngresos(d.simulada)),
      mejor: "sube",
      formato: meses,
    },
  ];
  const aguantas = unDecimal(mesesSinIngresos(d.simulada));
  const lineas = opciones.conLineas
    ? [...d.base.presupuesto.lineas.map((l) => l.recurrente.id), -1, -2, -3].map((id) => alMes(d, id, true))
    : [];
  return html`<div id="calculadora-resultado" class="calculadora-resultado" aria-live="polite">
      <section class="tarjeta tarjeta-mes">
        <div class="tarjeta-cabecera">
          <h2>Así quedaría</h2>
          ${n ? html`<a href="/calculadora">Volver a mis números</a>` : ""}
        </div>
        <p class="apagado pequeno" style="margin-top:0">
          ${n ? `Con ${n} ${n === 1 ? "cambio" : "cambios"}. No se guarda nada.` : "Aún no has cambiado nada: son tus números de verdad, los mismos que ves en el resto de la app."}
        </p>
        <div class="cifras">
          ${cifraComparada("Para ocio este mes", pa.ocio + pa.ocioRemanente, pb.ocio + pb.ocioRemanente, "sube")}
          ${cifraComparada("Toca ahorrar", pa.objetivoAhorro, pb.objetivoAhorro, "sube")}
          ${cifraComparada("Te sobra al mes", pa.sobrante, pb.sobrante, "sube")}
        </div>
        ${pb.sobrante < 0 ? html`<p class="negativo"><b>Gastarías ${eurR(-pb.sobrante)} al mes más de lo que ingresas:</b> no quedaría nada para ahorro ni ocio.</p>` : ""}
        ${pb.ingresos === 0 && pa.ingresos > 0 && aguantas !== null
          ? html`<p class="etapa-cambia">
              Sin ingresos, con los ${eurR(Math.max(d.simulada.situacion.liquidez, 0))} de tus cuentas aguantarías unos <b>${meses(aguantas)}</b> pagando solo lo esencial
              (${eurR(pb.esenciales)} al mes).
            </p>`
          : ""}
        ${barraReparto(pb)} ${fraseEtapa(d)}
      </section>
      ${d.simulada.adelantos.map((adelanto) => tarjetaAdelanto(adelanto, d))}
      <section class="tarjeta">
        <h2>Todas las cifras</h2>
        ${tablaComparada(filas)}
      </section>
      ${proyeccion(d, n > 0)}
      <section class="tarjeta">
        <h2>De dónde sale cada número</h2>
        <p class="apagado pequeno" style="margin-top:0">El mismo cálculo que en Ocio, paso a paso, con tus números y con la prueba.</p>
        ${tablaPasosComparada(d)}
        ${porque(
          "Primero se cubren los gastos. De lo que sobra, una parte se ahorra según tu etapa de la escalera (y lo que pidan tus metas); el resto es ocio, y nunca baja del ocio mínimo si te sobra dinero. Si en 2 de los 3 últimos cierres ahorraste menos de lo previsto, el ocio baja hasta que cuadre.",
        )}
      </section>
      <a class="calculadora-flotante" href="#calculadora-resultado">
        <span>Ocio <b>${eurR(pb.ocio + pb.ocioRemanente)}</b> ${diferencia(pa.ocio + pa.ocioRemanente, pb.ocio + pb.ocioRemanente, "sube", eurR)}</span>
        <span>Ahorro <b>${eurR(pb.objetivoAhorro)}</b> ${diferencia(pa.objetivoAhorro, pb.objetivoAhorro, "sube", eurR)}</span>
      </a>
    </div>
    ${lineas}`;
}
