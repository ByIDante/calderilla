import { createHash } from "node:crypto";
import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import { mesDe, primerDia, sumarDias, type Fecha } from "../dominio/fechas.ts";
import { estadoEn, importeEn, MESES_FRECUENCIA, mensualEn } from "../dominio/recurrencia.ts";
import {
  casaPatron,
  claveConcepto,
  detectarPeriodicos,
  emparejarTraspasos,
  estimacionesPorCategoria,
  type ApunteDetectable,
  type Estimacion,
  type Periodico,
} from "../importar/periodicos.ts";
import { leerAportaciones } from "./aportaciones.ts";
import { actualizarRecurrente, crearRecurrente, leerRecurrentes, type RecurrenteCompleto } from "./finanzas.ts";

/*
 * «Encontrado en tus movimientos»: convierte lo que se repite en tus movimientos importados en propuestas
 * (gastos e ingresos fijos, estimaciones por categoría, ahorro automático, cambios de precio) y las aplica
 * cuando las aceptas. Nada se crea sin confirmar. La detección en sí está en src/importar/periodicos.ts.
 */

/** Versión de las claves de «ignorar»: si cambia la forma de detectar, lo ignorado no vuelve a salir */
const VERSION = "v1";
/** Se mira algo más de un año de movimientos: lo justo para ver un seguro anual dos veces */
const DIAS_HISTORIA = 450;

interface FilaApunte {
  id: number;
  fecha: string;
  importe: number;
  concepto: string;
  categoria_id: number | null;
  cuenta_id: number | null;
  recurrente_id: number | null;
  traspaso: number | null;
  traspaso_par: number | null;
  vinculo_manual: number;
  origen: string;
}

interface Categoria {
  id: number;
  nombre: string;
  tipo: string;
}

export interface PropuestaCargo {
  /** Identificador corto para el formulario */
  id: string;
  /** Lo que se guarda al ignorarla */
  ignorar: string;
  periodico: Periodico;
  accion: "crear" | "vincular";
  /** Con «vincular»: el gasto o ingreso fijo que ya tienes y al que corresponde */
  recurrente: { id: number; nombre: string } | null;
  /**
   * Con «crear»: gastos que ya tienes en la misma categoría y que podrían ser este («Luz y gas» y la factura de
   * Iberdrola… o Netflix y Spotify, que no). Tú eliges; `sugerido` si el importe casi coincide.
   */
  posibles: { id: number; nombre: string; sugerido: boolean }[];
  categoria: string | null;
  esencial: boolean;
  /** Cuántos de sus movimientos quedarán unidos a él */
  vinculables: number;
}

export interface PropuestaAhorro {
  id: string;
  ignorar: string;
  periodico: Periodico;
  destino: { id: number; nombre: string };
  origen: string | null;
}

export interface PropuestaPrecio {
  id: string;
  ignorar: string;
  recurrente: { id: number; nombre: string };
  antes: Centimos;
  ahora: Centimos;
  desde: Fecha;
}

export interface PropuestaEstimacion {
  id: string;
  ignorar: string;
  categoriaId: number;
  categoria: string;
  esencial: boolean;
  mensual: Centimos;
  meses: { mes: string; total: Centimos }[];
  /** La estimación que ya tienes para esa categoría, si la hay (se propone actualizarla) */
  actual: { id: number; nombre: string; importe: Centimos } | null;
}

export interface Propuestas {
  gastos: PropuestaCargo[];
  ingresos: PropuestaCargo[];
  anuales: PropuestaCargo[];
  ahorros: PropuestaAhorro[];
  precios: PropuestaPrecio[];
  estimaciones: PropuestaEstimacion[];
  /** Lo que gastas al mes sin categoría: no entra en las estimaciones */
  sinCategoria: Centimos;
  /** Cuentas a las que puede ir un traspaso (para «es ahorro a una cuenta mía») */
  cuentas: { id: number; nombre: string }[];
  total: number;
}

const corto = (clave: string) => createHash("sha1").update(clave).digest("hex").slice(0, 10);
/** Franja de importe (cada una el doble que la anterior): ignorar Netflix a 13,99 € también vale si sube a 15,99 € */
const franja = (importe: Centimos) => Math.floor(Math.log2(Math.max(Math.abs(importe), 100) / 100));
const sinSigno = (clave: string) => clave.replace(/^[+-]:/, "");

function leerApuntes(bd: BaseDatos, hoy: Fecha): FilaApunte[] {
  return bd.todos<FilaApunte>(
    "SELECT id, fecha, importe, concepto, categoria_id, cuenta_id, recurrente_id, traspaso, traspaso_par, vinculo_manual, origen FROM apuntes WHERE fecha >= ? ORDER BY fecha, id",
    sumarDias(hoy, -DIAS_HISTORIA),
  );
}

const detectable = (a: FilaApunte): ApunteDetectable => ({ id: a.id, fecha: a.fecha, importe: a.importe, concepto: a.concepto, categoriaId: a.categoria_id, cuentaId: a.cuenta_id });

/**
 * Marca como traspaso las parejas de movimientos entre dos cuentas tuyas (sale de una y entra en otra).
 * Solo toca los que están «sin decidir»: lo que marcaste o desmarcaste a mano se respeta. Devuelve cuántas
 * parejas nuevas ha encontrado.
 */
export function marcarTraspasos(bd: BaseDatos, hoy: Fecha): number {
  const candidatos = leerApuntes(bd, hoy).filter((a) => a.traspaso === null && a.recurrente_id === null && a.cuenta_id !== null);
  const entidades = new Map(bd.todos<{ id: number; entidad: string | null; nombre: string }>("SELECT id, entidad, nombre FROM cuentas").map((c) => [c.id, c.entidad || c.nombre]));
  const parejas = emparejarTraspasos(candidatos.map(detectable), entidades);
  if (!parejas.length) return 0;
  bd.transaccion(() => {
    for (const [salida, entrada] of parejas) {
      bd.ejecutar("UPDATE apuntes SET traspaso = 1, traspaso_par = ? WHERE id = ?", entrada, salida);
      bd.ejecutar("UPDATE apuntes SET traspaso = 1, traspaso_par = ? WHERE id = ?", salida, entrada);
    }
  });
  return parejas.length;
}

/** El gasto o ingreso fijo que ya tienes y al que corresponde lo encontrado, si lo hay */
const parecido = (a: number, b: number, margen: number) => Math.abs(a - b) <= Math.max(a, b) * margen;

/**
 * El gasto o ingreso fijo que ya tienes y al que corresponde lo encontrado:
 * - seguro (se une sin preguntar): sus cargos ya se reconocían por ese texto, su nombre sale en el concepto
 *   («Alquiler» en «TRANSFERENCIA … ALQUILER»), es un préstamo con la misma cuota, o es una transferencia sin
 *   categoría con el mismo importe y cada cuánto;
 * - posibles (eliges tú): los de la misma categoría con un importe parecido. Que dos suscripciones cuesten
 *   casi lo mismo no las hace la misma.
 */
function relacionados(
  p: Periodico,
  recurrentes: readonly RecurrenteCompleto[],
  clavesVinculadas: ReadonlyMap<number, Set<string>>,
  mes: string,
): { seguro: RecurrenteCompleto | null; posibles: PropuestaCargo["posibles"] } {
  const clave = sinSigno(p.clave);
  const palabras = new Set(claveConcepto(p.ejemplo).palabras);
  const candidatos = recurrentes.filter((r) => r.tipo === p.tipo && (!r.fin || r.fin >= p.inicio));
  // Si ya se le reconocen cargos con otro texto, es otra cosa
  const otroTexto = (r: RecurrenteCompleto) => Boolean(r.patron) || [...(clavesVinculadas.get(r.id) ?? [])].some((k) => k && k !== clave);
  const seguro =
    candidatos.find((r) => r.patron && casaPatron(r.patron, p.ejemplo)) ??
    candidatos.find((r) => clavesVinculadas.get(r.id)?.has(clave)) ??
    candidatos.find((r) => !otroTexto(r) && claveConcepto(r.nombre).palabras.some((w) => palabras.has(w))) ??
    candidatos.find((r) => r.prestamo && parecido(importeEn(r.versiones, p.ultimo), p.importe, 0.05)) ??
    candidatos.find(
      (r) => !otroTexto(r) && p.categoriaId === null && r.clase === "fijo" && MESES_FRECUENCIA[r.frecuencia] === p.meses && parecido(importeEn(r.versiones, p.ultimo), p.importe, 0.05),
    ) ??
    null;
  const posibles = seguro
    ? []
    : candidatos
        .filter((r) => !otroTexto(r) && !r.prestamo && r.categoriaId !== null && r.categoriaId === p.categoriaId && parecido(mensualEn(r, r.versiones, mes), p.mensual, 0.5))
        .map((r) => ({ id: r.id, nombre: r.nombre, sugerido: parecido(mensualEn(r, r.versiones, mes), p.mensual, 0.1) }));
  return { seguro, posibles };
}

/** Lo que hace falta para calcular las propuestas, leído una vez */
interface Contexto {
  hoy: Fecha;
  mes: string;
  apuntes: FilaApunte[];
  recurrentes: RecurrenteCompleto[];
  categorias: Map<number, Categoria>;
  cuentas: { id: number; nombre: string }[];
  ignorados: Set<string>;
  ultimoPorCuenta: Map<number | null, Fecha>;
}

function leerContexto(bd: BaseDatos, hoy: Fecha): Contexto {
  const apuntes = leerApuntes(bd, hoy);
  const ultimoPorCuenta = new Map<number | null, Fecha>();
  for (const a of apuntes) ultimoPorCuenta.set(a.cuenta_id, a.fecha);
  return {
    hoy,
    mes: mesDe(hoy),
    apuntes,
    recurrentes: leerRecurrentes(bd),
    categorias: new Map(bd.todos<Categoria>("SELECT id, nombre, tipo FROM categorias").map((c) => [c.id, c])),
    cuentas: bd.todos<{ id: number; nombre: string }>("SELECT id, nombre FROM cuentas WHERE archivada = 0 ORDER BY nombre"),
    ignorados: new Set(bd.todos<{ clave: string }>("SELECT clave FROM periodicos_ignorados").map((f) => f.clave)),
    ultimoPorCuenta,
  };
}

/** Libres: sin gasto fijo, que no son traspaso y que no desvinculaste a mano */
const libresDe = (ctx: Contexto) => ctx.apuntes.filter((a) => a.recurrente_id === null && a.traspaso !== 1 && !a.vinculo_manual);

/**
 * Gastos e ingresos que se repiten: crear uno nuevo o unirlos al que ya tienes. Devuelve también todos los
 * movimientos que son periódicos (aunque ya estén en tu presupuesto), para no contarlos como gasto variable.
 */
function proponerCargos(ctx: Contexto): { cargos: PropuestaCargo[]; periodicos: Set<number> } {
  const anuales = new Set([...ctx.categorias.values()].filter((c) => /seguro|impuesto/i.test(c.nombre)).map((c) => c.id));
  const clavesVinculadas = new Map<number, Set<string>>();
  for (const a of ctx.apuntes.filter((x) => x.recurrente_id !== null)) {
    const claves = clavesVinculadas.get(a.recurrente_id!) ?? new Set<string>();
    claves.add(claveConcepto(a.concepto).clave);
    clavesVinculadas.set(a.recurrente_id!, claves);
  }
  const cargos: PropuestaCargo[] = [];
  const periodicos = new Set<number>();
  for (const p of detectarPeriodicos(libresDe(ctx).map(detectable), ctx.ultimoPorCuenta, anuales)) {
    const ignorar = `${VERSION}:${p.clave}:${franja(p.importe)}`;
    if (ctx.ignorados.has(ignorar)) continue;
    for (const id of p.apunteIds) periodicos.add(id);
    const { seguro: recurrente, posibles } = relacionados(p, ctx.recurrentes, clavesVinculadas, ctx.mes);
    const desde = sumarDias(recurrente?.inicio ?? p.inicio, -p.tolerancia);
    const vinculables = ctx.apuntes.filter((a) => p.apunteIds.includes(a.id) && a.fecha >= desde).length;
    // Ya lo tienes y sus cargos son de antes de que empezara: no hay nada que hacer
    if (recurrente && !vinculables) continue;
    const categoria = p.categoriaId === null ? undefined : ctx.categorias.get(p.categoriaId);
    cargos.push({
      id: corto(ignorar),
      ignorar,
      periodico: p,
      accion: recurrente ? "vincular" : "crear",
      recurrente: recurrente ? { id: recurrente.id, nombre: recurrente.nombre } : null,
      posibles,
      categoria: categoria?.nombre ?? null,
      esencial: p.tipo === "gasto" && (categoria ? categoria.tipo === "esencial" : p.canal === "recibo"),
      vinculables,
    });
  }
  return { cargos, periodicos };
}

/** Ahorro: traspasos que se repiten cada mes de una cuenta tuya a otra */
function proponerAhorros(ctx: Contexto, aportaciones: readonly { cuentaId: number | null }[]): PropuestaAhorro[] {
  const nombreCuenta = new Map(ctx.cuentas.map((c) => [c.id, c.nombre]));
  const salidas = ctx.apuntes.filter((a) => a.traspaso === 1 && a.importe < 0 && a.traspaso_par !== null);
  const destinoDe = new Map(ctx.apuntes.map((a) => [a.id, a.cuenta_id]));
  const ahorros: PropuestaAhorro[] = [];
  for (const destino of new Set(salidas.map((a) => destinoDe.get(a.traspaso_par!) ?? null))) {
    if (destino === null || aportaciones.some((a) => a.cuentaId === destino)) continue;
    const hacia = salidas.filter((a) => destinoDe.get(a.traspaso_par!) === destino);
    for (const p of detectarPeriodicos(hacia.map(detectable), ctx.ultimoPorCuenta).filter((x) => x.meses === 1 && x.clase === "fijo")) {
      const ignorar = `${VERSION}:ahorro:${destino}:${franja(p.importe)}`;
      if (ctx.ignorados.has(ignorar)) continue;
      ahorros.push({
        id: corto(ignorar),
        ignorar,
        periodico: p,
        destino: { id: destino, nombre: nombreCuenta.get(destino) ?? "?" },
        origen: p.cuentaId === null ? null : (nombreCuenta.get(p.cuentaId) ?? null),
      });
    }
  }
  return ahorros;
}

/** Precios que han cambiado: los dos últimos cargos coinciden entre sí y no con lo apuntado */
function proponerPrecios(ctx: Contexto): PropuestaPrecio[] {
  const igual = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01);
  const precios: PropuestaPrecio[] = [];
  for (const r of ctx.recurrentes.filter((x) => x.patron && x.clase === "fijo" && !x.prestamo && estadoEn(x, ctx.hoy) !== "finalizado")) {
    const [ultimo, penultimo] = ctx.apuntes.filter((a) => a.recurrente_id === r.id).sort((a, b) => b.fecha.localeCompare(a.fecha));
    if (!ultimo || !penultimo) continue;
    const ahora = Math.abs(ultimo.importe);
    const antes = importeEn(r.versiones, ultimo.fecha);
    const ignorar = `${VERSION}:precio:${r.id}:${ahora}`;
    if (!igual(Math.abs(penultimo.importe), ahora) || igual(ahora, antes) || ctx.ignorados.has(ignorar)) continue;
    precios.push({ id: corto(ignorar), ignorar, recurrente: { id: r.id, nombre: r.nombre }, antes, ahora, desde: penultimo.fecha });
  }
  return precios;
}

/** La estimación de una categoría: crearla, actualizarla si se aleja más de un 15 % de lo normal, o nada */
function estimacionDe(ctx: Contexto, e: Estimacion & { categoriaId: number }): PropuestaEstimacion | null {
  const categoria = ctx.categorias.get(e.categoriaId);
  if (!categoria || !["esencial", "otro"].includes(categoria.tipo) || e.mensual < 1000) return null;
  const suyas = ctx.recurrentes.filter(
    (r) => r.tipo === "gasto" && r.clase === "estimacion" && !r.patron && r.categoriaId === e.categoriaId && estadoEn(r, ctx.hoy) !== "finalizado",
  );
  if (suyas.length > 1) return null;
  const actual = suyas[0] ? { id: suyas[0].id, nombre: suyas[0].nombre, importe: mensualEn(suyas[0], suyas[0].versiones, ctx.mes) } : null;
  if (actual && Math.abs(actual.importe - e.mensual) <= Math.max(actual.importe, e.mensual) * 0.15) return null;
  const ignorar = `${VERSION}:estimacion:${e.categoriaId}:${franja(e.mensual)}`;
  if (ctx.ignorados.has(ignorar)) return null;
  return { id: corto(ignorar), ignorar, categoriaId: e.categoriaId, categoria: categoria.nombre, esencial: categoria.tipo === "esencial", mensual: e.mensual, meses: e.meses, actual };
}

/** Todo lo que se puede proponer ahora mismo. */
export function calcularPropuestas(bd: BaseDatos, hoy: Fecha): Propuestas {
  const ctx = leerContexto(bd, hoy);
  const { cargos, periodicos } = proponerCargos(ctx);
  const ahorros = proponerAhorros(ctx, leerAportaciones(bd).filter((a) => !a.fin || a.fin >= hoy));
  const precios = proponerPrecios(ctx);

  // Gasto variable de cada mes, sin lo que ya es periódico (aunque aún no lo hayas aceptado)
  const importados = ctx.apuntes.filter((a) => a.origen !== "manual");
  const cubiertos = importados.length ? { desde: importados[0]!.fecha, hasta: importados.at(-1)!.fecha } : null;
  const calculadas = estimacionesPorCategoria(
    libresDe(ctx).filter((a) => !periodicos.has(a.id)).map(detectable),
    cubiertos,
  );
  const estimaciones = calculadas
    .filter((e): e is Estimacion & { categoriaId: number } => e.categoriaId !== null)
    .map((e) => estimacionDe(ctx, e))
    .filter((e): e is PropuestaEstimacion => e !== null);

  return {
    gastos: cargos.filter((c) => c.periodico.tipo === "gasto" && !c.periodico.unico),
    ingresos: cargos.filter((c) => c.periodico.tipo === "ingreso"),
    anuales: cargos.filter((c) => c.periodico.unico),
    ahorros,
    precios,
    estimaciones,
    sinCategoria: calculadas.find((e) => e.categoriaId === null)?.mensual ?? 0,
    cuentas: ctx.cuentas,
    total: cargos.length + ahorros.length + precios.length + estimaciones.length,
  };
}

/** Lo que eliges en cada propuesta antes de aceptarla. */
export interface Eleccion {
  id: string;
  nombre?: string;
  esencial?: boolean;
  /** Un cargo por transferencia puede ser en realidad ahorro a otra cuenta tuya */
  como?: "gasto" | "ahorro";
  destino?: number | null;
  /** Unirlo a uno de los gastos que ya tienes (de los «posibles») en vez de crear otro */
  unir?: number | null;
}

export interface Aceptado {
  creados: number;
  vinculados: number;
  ahorros: number;
  precios: number;
  estimaciones: number;
  errores: string[];
}

function unirMovimientos(bd: BaseDatos, recurrenteId: number, p: Periodico, desde: Fecha) {
  for (const id of p.apunteIds) {
    bd.ejecutar("UPDATE apuntes SET recurrente_id = ? WHERE id = ? AND recurrente_id IS NULL AND vinculo_manual = 0 AND fecha >= ?", recurrenteId, id, desde);
  }
}

function crearAportacion(bd: BaseDatos, p: Periodico, destino: { id: number; nombre: string }) {
  bd.ejecutar(
    "INSERT INTO aportaciones (nombre, cuenta_id, importe, dia, inicio) VALUES (?, ?, ?, ?, ?)",
    `Traspaso a ${destino.nombre}`,
    destino.id,
    p.importe,
    Number(p.inicio.slice(8, 10)),
    p.inicio,
  );
}

function aceptarCargo(bd: BaseDatos, c: PropuestaCargo, e: Eleccion, cuentas: ReadonlyMap<number, string>, resultado: Aceptado) {
  const p = c.periodico;
  if (e.como === "ahorro") {
    const destino = e.destino ? cuentas.get(e.destino) : undefined;
    if (!destino) {
      resultado.errores.push(`Para apuntar «${p.nombre}» como ahorro, elige a qué cuenta va.`);
      return;
    }
    crearAportacion(bd, p, { id: e.destino!, nombre: destino });
    for (const id of p.apunteIds) bd.ejecutar("UPDATE apuntes SET traspaso = 1 WHERE id = ?", id);
    resultado.ahorros++;
    return;
  }
  const unirA = c.recurrente?.id ?? (e.unir && c.posibles.some((x) => x.id === e.unir) ? e.unir : null);
  if (unirA !== null) {
    const [r] = leerRecurrentes(bd, unirA);
    if (!r) return;
    if (!r.patron) bd.ejecutar("UPDATE recurrentes SET patron = ? WHERE id = ?", sinSigno(p.clave), r.id);
    // Si sus cargos varían (la luz), pasa a estimación: así se reconocen aunque cada factura sea distinta
    if (p.clase === "estimacion" && r.clase === "fijo" && !r.prestamo) bd.ejecutar("UPDATE recurrentes SET clase = 'estimacion' WHERE id = ?", r.id);
    unirMovimientos(bd, r.id, p, sumarDias(r.inicio, -p.tolerancia));
    resultado.vinculados++;
    return;
  }
  const bimestral = p.meses === 2;
  const id = crearRecurrente(bd, {
    tipo: p.tipo,
    nombre: e.nombre?.trim() || p.nombre,
    categoriaId: p.categoriaId,
    frecuencia: p.frecuencia,
    inicio: p.inicio,
    fin: null,
    esencial: p.tipo === "gasto" && (e.esencial ?? c.esencial),
    clase: p.clase,
    nota: bimestral ? "Se cobra cada 2 meses: aquí cuenta la mitad de cada factura." : null,
    importe: bimestral ? p.mensual : p.escalones[0]!.importe,
    prestamo: null,
    patron: sinSigno(p.clave),
  });
  // Cada cambio de precio, desde su fecha: los meses pasados conservan el importe que tenían
  for (const escalon of bimestral ? [] : p.escalones.slice(1)) {
    bd.ejecutar(
      "INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, ?, ?) ON CONFLICT (recurrente_id, valido_desde) DO UPDATE SET importe = excluded.importe",
      id,
      escalon.desde,
      escalon.importe,
    );
  }
  unirMovimientos(bd, id, p, sumarDias(p.inicio, -p.tolerancia));
  resultado.creados++;
}

function aceptarEstimacion(bd: BaseDatos, e: PropuestaEstimacion, hoy: Fecha) {
  const desde = primerDia(mesDe(hoy));
  const [r] = e.actual ? leerRecurrentes(bd, e.actual.id) : [];
  if (r) {
    actualizarRecurrente(bd, r.id, { ...r, importe: e.mensual, prestamo: null }, desde);
    return;
  }
  crearRecurrente(bd, {
    tipo: "gasto",
    nombre: e.categoria,
    categoriaId: e.categoriaId,
    frecuencia: "mensual",
    inicio: desde,
    fin: null,
    esencial: e.esencial,
    clase: "estimacion",
    nota: "Calculado con tus movimientos: lo normal de los últimos meses.",
    importe: e.mensual,
    prestamo: null,
  });
}

/**
 * Aplica las propuestas elegidas. Se vuelven a calcular aquí (no se fía de lo que llega del formulario) y se
 * aplican en orden: cargos y ahorro, precios y, al final, estimaciones.
 */
export function aceptarPropuestas(bd: BaseDatos, hoy: Fecha, elecciones: readonly Eleccion[]): Aceptado {
  const propuestas = calcularPropuestas(bd, hoy);
  const elegida = new Map(elecciones.map((e) => [e.id, e]));
  const cuentas = new Map(propuestas.cuentas.map((c) => [c.id, c.nombre]));
  const resultado: Aceptado = { creados: 0, vinculados: 0, ahorros: 0, precios: 0, estimaciones: 0, errores: [] };
  bd.transaccion(() => {
    for (const c of [...propuestas.ingresos, ...propuestas.gastos, ...propuestas.anuales]) {
      const e = elegida.get(c.id);
      if (e) aceptarCargo(bd, c, e, cuentas, resultado);
    }
    for (const a of propuestas.ahorros.filter((x) => elegida.has(x.id))) {
      crearAportacion(bd, a.periodico, a.destino);
      resultado.ahorros++;
    }
    for (const p of propuestas.precios.filter((x) => elegida.has(x.id))) {
      bd.ejecutar(
        "INSERT INTO recurrentes_importes (recurrente_id, valido_desde, importe) VALUES (?, ?, ?) ON CONFLICT (recurrente_id, valido_desde) DO UPDATE SET importe = excluded.importe",
        p.recurrente.id,
        p.desde,
        p.ahora,
      );
      resultado.precios++;
    }
    for (const e of propuestas.estimaciones.filter((x) => elegida.has(x.id))) {
      aceptarEstimacion(bd, e, hoy);
      resultado.estimaciones++;
    }
  });
  return resultado;
}

/** «No, gracias»: esa propuesta no vuelve a salir. */
export function ignorarPropuesta(bd: BaseDatos, hoy: Fecha, id: string): boolean {
  const p = calcularPropuestas(bd, hoy);
  const encontrada = [...p.gastos, ...p.ingresos, ...p.anuales, ...p.ahorros, ...p.precios, ...p.estimaciones].find((x) => x.id === id);
  if (!encontrada) return false;
  bd.ejecutar("INSERT OR REPLACE INTO periodicos_ignorados (clave, ignorado) VALUES (?, ?)", encontrada.ignorar, hoy);
  return true;
}
