import { createHash } from "node:crypto";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { leerImporte, type Centimos } from "../dominio/dinero.ts";
import { esFecha, type Fecha } from "../dominio/fechas.ts";

/*
 * Lectura de extractos bancarios en CSV o Excel. Cada banco los exporta a su manera, así que el usuario
 * elige qué columna es cada cosa (la primera vez se adivina) y el formato se recuerda para la próxima.
 */

export type Filas = string[][];

export interface Configuracion {
  /** Índice de la fila con los títulos de las columnas (los datos empiezan en la siguiente). */
  filaCabecera: number;
  fecha: number;
  concepto: number;
  /** Una sola columna con el importe (negativo = gasto)… */
  importe: number | null;
  /** …o dos columnas: cargos y abonos. */
  cargo: number | null;
  abono: number | null;
  formatoFecha: "dmy" | "ymd" | "mdy";
  /** Hay bancos que ponen los gastos en positivo. */
  invertirSigno: boolean;
}

export interface Movimiento {
  fila: number;
  fecha: Fecha;
  importe: Centimos;
  concepto: string;
}

/** Los extractos españoles suelen venir en Windows-1252 (Excel) en vez de UTF-8. */
export function decodificar(buffer: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buffer) : utf8.replace(/^﻿/, "");
}

export function leerArchivo(nombre: string, buffer: Uint8Array): Filas {
  const filas = /\.(xlsx?|ods)$/i.test(nombre) ? leerHoja(buffer) : leerCsv(decodificar(buffer));
  return filas.map((fila) => fila.map((celda) => String(celda ?? "").trim())).filter((fila) => fila.some(Boolean));
}

/**
 * El separador es el que aparece el mismo número de veces en más líneas. PapaParse solo mira el principio y
 * se confunde con las comas decimales («-700,00») cuando la primera línea es un título sin separadores.
 */
export function separador(texto: string): string {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 50);
  let mejor = { separador: ";", puntos: -1 };
  for (const candidato of [";", "\t", ",", "|"]) {
    const cuentas = lineas.map((l) => l.split(candidato).length - 1).filter((n) => n > 0);
    const frecuencias = new Map<number, number>();
    for (const n of cuentas) frecuencias.set(n, (frecuencias.get(n) ?? 0) + 1);
    const puntos = Math.max(0, ...frecuencias.values());
    if (puntos > mejor.puntos) mejor = { separador: candidato, puntos };
  }
  return mejor.separador;
}

function leerCsv(texto: string): Filas {
  return Papa.parse<string[]>(texto, { skipEmptyLines: true, delimiter: separador(texto) }).data;
}

function leerHoja(buffer: Uint8Array): Filas {
  // dateNF va en read (en sheet_to_json se ignora): así el formato de fecha corta de Excel sale como 2026-10-03
  const libro = XLSX.read(buffer, { type: "array", cellDates: true, dateNF: "yyyy-mm-dd" });
  const hoja = libro.Sheets[libro.SheetNames[0] ?? ""];
  if (!hoja) return [];
  return XLSX.utils.sheet_to_json<string[]>(hoja, { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" });
}

const quitarAcentos = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function leerFecha(texto: string, formato: Configuracion["formatoFecha"]): Fecha | null {
  const limpio = texto.trim().slice(0, 10);
  if (esFecha(limpio)) return limpio;
  const partes = limpio.split(/[/.\-\s]/).filter(Boolean);
  if (partes.length !== 3) return null;
  const [a, b, c] = partes as [string, string, string];
  let dia: string, mes: string, anio: string;
  if (formato === "ymd") [anio, mes, dia] = [a, b, c];
  else if (formato === "mdy") [mes, dia, anio] = [a, b, c];
  else [dia, mes, anio] = [a, b, c];
  if (anio.length === 2) anio = `20${anio}`;
  const fecha = `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  return esFecha(fecha) ? fecha : null;
}

const PISTAS = {
  fecha: /^(fecha( de)? (operacion|contable|valor)?|f\. ?(operacion|valor|contable)|fecha|date)$/,
  concepto: /(concepto|descripcion|detalle|movimiento|description)/,
  importe: /^(importe|cantidad|amount|importe \(?eur\)?|importe €)$/,
  cargo: /(cargo|debe|gasto|debit)/,
  abono: /(abono|haber|ingreso|credit)/,
};

/** Primera aproximación: busca la fila de títulos y las columnas por su nombre. */
export function adivinar(filas: Filas): Configuracion {
  const indiceCabecera = filas.slice(0, 20).findIndex((fila) => fila.some((c) => PISTAS.fecha.test(quitarAcentos(c))) && fila.some((c) => /importe|cantidad|amount|cargo|abono/.test(quitarAcentos(c))));
  const filaCabecera = Math.max(indiceCabecera, 0);
  const titulos = (filas[filaCabecera] ?? []).map(quitarAcentos);
  const buscar = (patron: RegExp) => {
    const i = titulos.findIndex((t) => patron.test(t));
    return i >= 0 ? i : null;
  };
  const importe = buscar(PISTAS.importe);
  const cargo = importe === null ? buscar(PISTAS.cargo) : null;
  const abono = importe === null ? buscar(PISTAS.abono) : null;
  const ejemplo = filas[filaCabecera + 1]?.[buscar(PISTAS.fecha) ?? 0] ?? "";
  return {
    filaCabecera,
    fecha: buscar(PISTAS.fecha) ?? 0,
    concepto: buscar(PISTAS.concepto) ?? 1,
    importe: importe ?? (cargo === null && abono === null ? 2 : null),
    cargo,
    abono,
    formatoFecha: /^\d{4}/.test(ejemplo) ? "ymd" : "dmy",
    invertirSigno: false,
  };
}

/** Títulos de las columnas, para reconocer el formato de un banco la próxima vez. */
export function firma(filas: Filas, filaCabecera: number): string {
  return (filas[filaCabecera] ?? []).map(quitarAcentos).join("|");
}

export function interpretar(filas: Filas, cfg: Configuracion): { movimientos: Movimiento[]; errores: number } {
  const movimientos: Movimiento[] = [];
  let errores = 0;
  filas.slice(cfg.filaCabecera + 1).forEach((fila, i) => {
    const fecha = leerFecha(fila[cfg.fecha] ?? "", cfg.formatoFecha);
    let importe: number | null;
    if (cfg.importe !== null) {
      importe = leerImporte(fila[cfg.importe] ?? "");
    } else {
      const cargo = cfg.cargo === null ? 0 : (leerImporte(fila[cfg.cargo] ?? "") ?? 0);
      const abono = cfg.abono === null ? 0 : (leerImporte(fila[cfg.abono] ?? "") ?? 0);
      importe = abono - Math.abs(cargo);
    }
    const concepto = (fila[cfg.concepto] ?? "").replace(/\s+/g, " ").trim();
    if (!fecha || importe === null || importe === 0) {
      errores++;
      return;
    }
    movimientos.push({ fila: cfg.filaCabecera + 1 + i, fecha, importe: cfg.invertirSigno ? -importe : importe, concepto: concepto || "(sin concepto)" });
  });
  return { movimientos, errores };
}

/**
 * Huella de cada movimiento para no importarlo dos veces. Si el mismo día hay dos movimientos idénticos
 * (dos cafés de 1,50 €), el número de orden los distingue.
 */
export function huellas(movimientos: readonly Movimiento[], cuentaId: number | null): string[] {
  const vistos = new Map<string, number>();
  return movimientos.map((m) => {
    const base = `${cuentaId ?? ""}|${m.fecha}|${m.importe}|${quitarAcentos(m.concepto)}`;
    const orden = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, orden);
    return createHash("sha1").update(`${base}|${orden}`).digest("hex");
  });
}

export interface Regla {
  patron: string;
  categoriaId: number;
}

/** La regla más concreta gana: «uber eats» antes que «uber ». */
export function categoriaPorReglas(concepto: string, reglas: readonly Regla[]): number | null {
  const texto = quitarAcentos(concepto);
  return [...reglas].sort((a, b) => b.patron.length - a.patron.length).find((regla) => texto.includes(quitarAcentos(regla.patron)))?.categoriaId ?? null;
}
