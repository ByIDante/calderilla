import { html } from "hono/html";
import { importeEditable, numeroEditable } from "../../dominio/dinero.ts";
import { formatoFecha, type Fecha } from "../../dominio/fechas.ts";
import { cuadroAmortizacion, cuotaMensual, pendienteEn, taeDe } from "../../dominio/prestamo.ts";
import { cuotasRestantes, estadoEn, importeEn, MESES_FRECUENCIA, NOMBRE_FRECUENCIA, proximaOcurrencia, type Frecuencia } from "../../dominio/recurrencia.ts";
import type { RecurrenteCompleto } from "../../servicios/finanzas.ts";
import { botonAccion, campo, casilla, eur, pct, selector, vacio, type Html } from "./comun.ts";

export interface Categoria {
  id: number;
  nombre: string;
  tipo: "esencial" | "ocio" | "otro" | "ingreso";
}

function etiquetaFin(r: RecurrenteCompleto, hoy: Fecha): string {
  if (!r.fin) return "Sin fin";
  const quedan = cuotasRestantes(r, hoy);
  return `${formatoFecha(r.fin)}${quedan ? ` · quedan ${quedan}` : ""}`;
}

function filas(lista: RecurrenteCompleto[], hoy: Fecha, mensual: Map<number, number>): Html {
  return html`${lista.map((r) => {
    const estado = estadoEn(r, hoy);
    const importe = importeEn(r.versiones, hoy);
    return html`<tr class="${estado === "finalizado" ? "finalizado" : ""}">
      <td>
        <a href="/gastos/${r.id}">${r.nombre}</a>
        <div class="apagado pequeno">
          ${[r.categoria, r.tipo === "gasto" ? (r.esencial ? "esencial" : "no esencial") : null, r.clase === "estimacion" ? "estimación" : null, r.prestamo ? "préstamo" : null, estado === "proximo" ? "empieza más adelante" : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </td>
      <td class="numero">${eur(importe)} <span class="apagado pequeno">${NOMBRE_FRECUENCIA[r.frecuencia]}</span></td>
      <td class="numero">${estado === "finalizado" ? "—" : eur(mensual.get(r.id) ?? 0)}</td>
      <td>${etiquetaFin(r, hoy)}</td>
    </tr>`;
  })}`;
}

function tabla(titulo: string, lista: RecurrenteCompleto[], hoy: Fecha, mensual: Map<number, number>, total: number | null): Html {
  return html`<div class="tabla-contenedor">
    <table class="tabla-fija">
      <caption class="sr">${titulo}</caption>
      <colgroup><col /><col class="col-importe" /><col class="col-mes" /><col class="col-fin" /></colgroup>
      <thead>
        <tr><th>Concepto</th><th class="numero">Importe</th><th class="numero">Al mes</th><th>Termina</th></tr>
      </thead>
      <tbody>
        ${filas(lista, hoy, mensual)}
      </tbody>
      ${total === null ? "" : html`<tfoot><tr><td>Total al mes</td><td></td><td class="numero">${eur(total)}</td><td></td></tr></tfoot>`}
    </table>
  </div>`;
}

export function vistaLista(recurrentes: RecurrenteCompleto[], hoy: Fecha, mensual: Map<number, number>): Html {
  const vivos = recurrentes.filter((r) => estadoEn(r, hoy) !== "finalizado");
  const finalizados = recurrentes.filter((r) => estadoEn(r, hoy) === "finalizado");
  const ingresos = vivos.filter((r) => r.tipo === "ingreso");
  const esenciales = vivos.filter((r) => r.tipo === "gasto" && r.esencial);
  const otros = vivos.filter((r) => r.tipo === "gasto" && !r.esencial);
  const suma = (lista: RecurrenteCompleto[]) => lista.reduce((s, r) => s + (mensual.get(r.id) ?? 0), 0);

  return html`
    <div class="botones bloque">
      <a class="boton boton-principal" href="/gastos/nuevo">Añadir gasto</a>
      <a class="boton" href="/gastos/nuevo?tipo=ingreso">Añadir ingreso</a>
      <a class="boton" href="/gastos/nuevo?prestamo=1">Añadir préstamo</a>
    </div>
    <p class="apagado">
      Los gastos que no son mensuales (seguros, IBI, ITV…) se reparten entre los meses anteriores a cada cargo: así el «al mes» refleja lo que deberías ir apartando.
      Cuando un gasto llega a su fecha de fin pasa solo a «Finalizados».
    </p>
    <p class="apagado">
      Lo que traspasas cada mes a tu cuenta de ahorro (Trade Republic, por ejemplo) o a un fondo <b>no es un gasto</b>: es ahorro. Apúntalo en
      <a href="/cuentas#ahorro-automatico">Cuentas → Ahorro automático</a>.
    </p>
    <section class="tarjeta">
      <h2>Ingresos</h2>
      ${ingresos.length ? tabla("Ingresos", ingresos, hoy, mensual, suma(ingresos)) : vacio("Sin ingresos apuntados.", html`<a href="/gastos/nuevo?tipo=ingreso">Apuntar la nómina</a>`)}
    </section>
    <section class="tarjeta">
      <h2>Gastos esenciales</h2>
      ${esenciales.length ? tabla("Gastos esenciales", esenciales, hoy, mensual, suma(esenciales)) : vacio("Sin gastos esenciales apuntados.")}
    </section>
    <section class="tarjeta">
      <h2>Gastos no esenciales</h2>
      ${otros.length ? tabla("Gastos no esenciales", otros, hoy, mensual, suma(otros)) : vacio("Sin gastos no esenciales apuntados.")}
    </section>
    ${finalizados.length
      ? html`<section class="tarjeta">
          <details>
            <summary><h2 style="display:inline">Finalizados (${finalizados.length})</h2></summary>
            <p class="apagado pequeno">Ya no cuentan en el presupuesto, pero siguen en el historial de los meses en que estuvieron activos.</p>
            ${tabla("Finalizados", finalizados, hoy, mensual, null)}
          </details>
        </section>`
      : ""}
  `;
}

export type Valores = Record<string, string>;

export function valoresDe(r: RecurrenteCompleto, hoy: Fecha): Valores {
  return {
    tipo: r.tipo,
    nombre: r.nombre,
    categoria: r.categoriaId ? String(r.categoriaId) : "",
    importe: importeEditable(importeEn(r.versiones, hoy)),
    frecuencia: r.frecuencia,
    inicio: r.inicio,
    fin_modo: r.fin ? "fecha" : "sin",
    fin: r.fin ?? "",
    cuotas: "",
    esencial: r.esencial ? "1" : "",
    clase: r.clase,
    nota: r.nota ?? "",
    prestamo: r.prestamo ? "1" : "",
    capital: importeEditable(r.prestamo?.capital),
    tin: numeroEditable(r.prestamo?.tin),
    tae: numeroEditable(r.prestamo?.tae),
    plazo: r.prestamo ? String(r.prestamo.plazoMeses) : "",
    comision: numeroEditable(r.prestamo?.comisionAmortizacion),
    vinculado: r.prestamo?.vinculado ? "1" : "",
    desde: hoy,
  };
}

const FRECUENCIAS = (Object.keys(MESES_FRECUENCIA) as Frecuencia[]).map((f) => [f, NOMBRE_FRECUENCIA[f].replace(/^al /, "Una vez al ").replace(/^cada/, "Cada")] as const);

export function vistaFormulario(opciones: { accion: string; valores: Valores; categorias: Categoria[]; editando: RecurrenteCompleto | null; hoy: Fecha }): Html {
  const v = opciones.valores;
  const r = opciones.editando;
  const opcionesCategoria = [["", "Sin categoría"] as const, ...opciones.categorias.map((c) => [String(c.id), c.nombre] as const)];
  return html`
    <form method="post" action="${opciones.accion}" class="formulario tarjeta">
      <div class="fila-campos">
        ${selector("Tipo", "tipo", [["gasto", "Gasto"], ["ingreso", "Ingreso"]], v.tipo)}
        ${campo({ etiqueta: "Concepto", nombre: "nombre", valor: v.nombre, requerido: true, marcador: "Alquiler, nómina, coche…" })}
        ${selector("Categoría", "categoria", opcionesCategoria, v.categoria)}
      </div>

      ${casilla("Es un préstamo o una compra a plazos", "prestamo", v.prestamo === "1", "La cuota y la fecha de fin se calculan a partir del préstamo; al acabar desaparece sola.")}

      <fieldset data-mostrar-si="campo-prestamo">
        <legend>Préstamo</legend>
        <div class="fila-campos">
          ${campo({ etiqueta: "Capital prestado", nombre: "capital", valor: v.capital, sufijo: "€" })}
          ${campo({ etiqueta: "TIN", nombre: "tin", valor: v.tin, sufijo: "%", ayuda: "Tipo de interés nominal anual del contrato." })}
          ${campo({ etiqueta: "TAE (opcional)", nombre: "tae", valor: v.tae, sufijo: "%", ayuda: "Si no la pones, se calcula a partir del TIN." })}
          ${campo({ etiqueta: "Plazo en meses", nombre: "plazo", valor: v.plazo, sufijo: "", ayuda: "5 años = 60 meses." })}
          ${campo({ etiqueta: "Comisión por amortizar", nombre: "comision", valor: v.comision, sufijo: "%", ayuda: "Lo que cobran por adelantar pagos (en préstamos al consumo, máx. 1 %)." })}
        </div>
        ${casilla("El precio dependía de mantener esta financiación", "vinculado", v.vinculado === "1", "Típico al comprar un coche: si amortizas antes, podrías perder el descuento.")}
      </fieldset>

      <div class="fila-campos">
        ${campo({
          etiqueta: "Importe",
          nombre: "importe",
          valor: v.importe,
          sufijo: "€",
          ayuda: v.prestamo === "1" ? "Cuota mensual. Si la dejas vacía, se calcula." : "Lo que pagas o cobras cada vez.",
        })}
        <div data-ocultar-si="campo-prestamo">${selector("Cada cuánto", "frecuencia", FRECUENCIAS, v.frecuencia)}</div>
        ${campo({ etiqueta: v.prestamo === "1" ? "Fecha de la primera cuota" : "Fecha del primer cargo o cobro", nombre: "inicio", valor: v.inicio, tipo: "date", requerido: true })}
      </div>

      <div class="fila-campos" data-ocultar-si="campo-prestamo">
        ${selector("¿Tiene fin?", "fin_modo", [["sin", "No, sigue hasta que lo quite"], ["fecha", "Sí, hasta una fecha"], ["cuotas", "Sí, un número de pagos"]], v.fin_modo)}
        <div data-mostrar-si="campo-fin_modo=fecha">${campo({ etiqueta: "Último cargo", nombre: "fin", valor: v.fin, tipo: "date" })}</div>
        <div data-mostrar-si="campo-fin_modo=cuotas">${campo({ etiqueta: "Número de pagos", nombre: "cuotas", valor: v.cuotas, sufijo: "", ayuda: "Contando el primero." })}</div>
      </div>

      <div class="fila-campos" data-mostrar-si="campo-tipo=gasto">
        ${casilla("Es esencial", "esencial", v.esencial === "1", "Vivienda, comida, suministros, transporte, seguros, préstamos… Cuenta para el fondo de emergencia.")}
        ${selector("¿El importe varía?", "clase", [["fijo", "No, es fijo"], ["estimacion", "Sí, es una estimación (comida, gasolina…)"]], v.clase)}
      </div>

      ${r ? campo({ etiqueta: "Si cambia el importe, aplicarlo desde", nombre: "desde", valor: v.desde, tipo: "date", ayuda: "Los meses anteriores conservan el importe que tenían." }) : ""}
      ${campo({ etiqueta: "Nota (opcional)", nombre: "nota", valor: v.nota })}

      <div class="botones">
        <button type="submit" class="boton boton-principal">Guardar</button>
        <a class="boton" href="/gastos">Cancelar</a>
      </div>
    </form>
    ${r ? vistaGestion(r, opciones.hoy) : ""}
  `;
}

function vistaGestion(r: RecurrenteCompleto, hoy: Fecha): Html {
  const prestamo = r.prestamo;
  return html`
    ${prestamo
      ? html`<section class="tarjeta">
          <h2>El préstamo hoy</h2>
          <ul class="lista-plana">
            <li><span>Cuota calculada</span><span class="numero">${eur(cuotaMensual(prestamo.capital, prestamo.tin, prestamo.plazoMeses))}</span></li>
            <li><span>TAE ${prestamo.tae === null ? "aproximada" : ""}</span><span class="numero">${pct(taeDe(prestamo))}</span></li>
            <li><span>Pendiente de devolver</span><span class="numero">${eur(pendienteEn(prestamo, hoy))}</span></li>
            <li><span>Intereses que quedan por pagar</span><span class="numero">${eur(cuadroAmortizacion(prestamo).filter((f) => f.fecha > hoy).reduce((s, f) => s + f.intereses, 0))}</span></li>
            <li><span>Última cuota</span><span>${formatoFecha(r.fin)}</span></li>
          </ul>
          <p><a href="/gastos/${r.id}/cuadro">Ver el cuadro de amortización</a></p>
        </section>
        <section class="tarjeta">
          <h2>Amortizar antes de tiempo</h2>
          ${(prestamo.amortizaciones ?? []).length
            ? html`<ul class="lista-plana bloque">
                ${(prestamo.amortizaciones ?? []).map((a) => html`<li><span>${formatoFecha(a.fecha)} · ${a.modo === "cuota" ? "bajando la cuota" : "acortando el plazo"}</span><span class="numero">${eur(a.importe)}</span></li>`)}
              </ul>`
            : ""}
          <p class="apagado">Antes de hacerlo, mira en Inversiones si la regla lo recomienda para este préstamo${prestamo.vinculado ? " y recuerda que el precio dependía de mantener la financiación" : ""}.</p>
          <form method="post" action="/gastos/${r.id}/amortizar" class="formulario">
            <div class="fila-campos">
              ${campo({ etiqueta: "Importe", nombre: "importe", sufijo: "€", requerido: true, id: "importe-amortizar" })}
              ${campo({ etiqueta: "Fecha", nombre: "fecha", tipo: "date", valor: hoy, id: "fecha-amortizar" })}
              ${selector("Qué reducir", "modo", [["plazo", "El plazo (misma cuota, acabas antes)"], ["cuota", "La cuota (mismo plazo, pagas menos al mes)"]], "plazo", "Reducir plazo suele ahorrar más intereses.")}
            </div>
            <div class="botones"><button class="boton" type="submit">Apuntar amortización</button></div>
          </form>
        </section>`
      : ""}
    ${r.versiones.length > 1
      ? html`<section class="tarjeta">
          <h2>Historial de importes</h2>
          <ul class="lista-plana">
            ${r.versiones.map((v) => html`<li><span>Desde ${formatoFecha(v.validoDesde)}</span><span class="numero">${eur(v.importe)}</span></li>`)}
          </ul>
        </section>`
      : ""}
    <section class="tarjeta">
      <h2>Quitar</h2>
      <p class="apagado">Si ya no lo pagas o cobras, ponle fecha de fin: deja de contar desde ese día pero el historial se conserva. Próximo cargo: ${formatoFecha(proximaOcurrencia(r, hoy)) || "ninguno"}.</p>
      <form method="post" action="/gastos/${r.id}/terminar" class="botones">
        <input type="date" name="fecha" value="${hoy}" aria-label="Fecha del último cargo" style="max-width: 180px" />
        <button type="submit" class="boton">Termina en esta fecha</button>
      </form>
      <p class="apagado pequeno">¿Lo apuntaste por error? ${botonAccion(`/gastos/${r.id}/borrar`, "Borrarlo del todo", { estilo: "enlace", confirmar: `¿Borrar «${r.nombre}» y todo su historial?` })}</p>
    </section>
  `;
}

export function vistaCuadro(r: RecurrenteCompleto, hoy: Fecha): Html {
  if (!r.prestamo) return vacio("No es un préstamo.");
  const cuadro = cuadroAmortizacion(r.prestamo);
  return html`<section class="tarjeta">
    <p><a href="/gastos/${r.id}">← Volver a «${r.nombre}»</a></p>
    <div class="tabla-contenedor">
      <table>
        <thead>
          <tr><th>Nº</th><th>Fecha</th><th class="numero">Anticipado</th><th class="numero">Cuota</th><th class="numero">Intereses</th><th class="numero">Amortizado</th><th class="numero">Pendiente</th></tr>
        </thead>
        <tbody>
          ${cuadro.map(
            (f) => html`<tr class="${f.fecha <= hoy ? "finalizado" : ""}">
              <td>${f.numero}</td><td>${formatoFecha(f.fecha)}</td><td class="numero">${f.anticipado ? eur(f.anticipado) : ""}</td><td class="numero">${eur(f.cuota)}</td><td class="numero">${eur(f.intereses)}</td>
              <td class="numero">${eur(f.amortizacion)}</td><td class="numero">${eur(f.pendiente)}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </section>`;
}
