import Papa from "papaparse";
import YahooFinance from "yahoo-finance2";
import { sumarDias, type Fecha } from "../dominio/fechas.ts";

/*
 * Fuentes gratuitas de precios. Ninguna es un servicio de pago ni necesita cuenta (CoinGecko admite una
 * clave Demo gratuita opcional). Yahoo no es una API oficial: si deja de funcionar, el precio manual sigue
 * funcionando siempre.
 */

export type Fuente = "yahoo" | "coingecko";

export interface ResultadoBusqueda {
  fuente: Fuente;
  simbolo: string;
  nombre: string;
  tipo: string;
  mercado: string | null;
}

export interface Cotizacion {
  fecha: Fecha;
  precio: number;
  /** Moneda del precio, si la fuente la indica. */
  moneda: string | null;
}

const TIEMPO_MAXIMO_MS = 15_000;

async function pedirJson(url: string, cabeceras: Record<string, string> = {}): Promise<unknown> {
  const respuesta = await fetch(url, { headers: { accept: "application/json", ...cabeceras }, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
  if (!respuesta.ok) throw new Error(`${new URL(url).host} respondió ${respuesta.status}`);
  return respuesta.json();
}

// ── Yahoo Finance (ETF, acciones y fondos con identificador de Morningstar «0P…») ──

const TIPOS_YAHOO: Record<string, string> = { EQUITY: "Acción", ETF: "ETF", MUTUALFUND: "Fondo", INDEX: "Índice", CRYPTOCURRENCY: "Cripto" };

export function interpretarBusquedaYahoo(quotes: readonly Record<string, unknown>[]): ResultadoBusqueda[] {
  return quotes
    .filter((q) => typeof q.symbol === "string" && typeof q.quoteType === "string" && q.quoteType in TIPOS_YAHOO)
    .map((q) => ({
      fuente: "yahoo" as const,
      simbolo: q.symbol as string,
      nombre: String(q.longname ?? q.shortname ?? q.symbol),
      tipo: TIPOS_YAHOO[q.quoteType as string] ?? String(q.quoteType),
      mercado: typeof q.exchDisp === "string" ? q.exchDisp : typeof q.exchange === "string" ? q.exchange : null,
    }));
}

export function interpretarGraficoYahoo(grafico: { meta: { currency?: string | null }; quotes: readonly { date: Date; close?: number | null }[] }): Cotizacion | null {
  const ultima = [...grafico.quotes].reverse().find((q) => typeof q.close === "number" && q.close > 0);
  if (!ultima?.close) return null;
  let moneda = grafico.meta.currency ?? null;
  let precio = ultima.close;
  // La bolsa de Londres cotiza en peniques
  if (moneda === "GBp" || moneda === "GBX") {
    moneda = "GBP";
    precio /= 100;
  }
  return { fecha: ultima.date.toISOString().slice(0, 10), precio, moneda };
}

let yahoo: InstanceType<typeof YahooFinance> | null = null;
const clienteYahoo = () => (yahoo ??= new YahooFinance({ suppressNotices: ["yahooSurvey"] }));

export async function buscarYahoo(texto: string): Promise<ResultadoBusqueda[]> {
  const resultado = await clienteYahoo().search(texto, { quotesCount: 8, newsCount: 0 });
  return interpretarBusquedaYahoo(resultado.quotes as unknown as Record<string, unknown>[]);
}

export async function cotizacionYahoo(simbolo: string, hoy: Fecha): Promise<Cotizacion | null> {
  const grafico = await clienteYahoo().chart(simbolo, { period1: sumarDias(hoy, -14), interval: "1d" });
  return interpretarGraficoYahoo(grafico);
}

// ── CoinGecko (criptomonedas) ──

const COINGECKO = "https://api.coingecko.com/api/v3";
const cabecerasCoingecko = (clave: string | null): Record<string, string> => (clave ? { "x-cg-demo-api-key": clave } : {});

export function interpretarBusquedaCoingecko(json: unknown): ResultadoBusqueda[] {
  const monedas = (json as { coins?: { id: string; name: string; symbol: string }[] }).coins ?? [];
  return monedas.slice(0, 8).map((m) => ({ fuente: "coingecko" as const, simbolo: m.id, nombre: `${m.name} (${m.symbol.toUpperCase()})`, tipo: "Cripto", mercado: null }));
}

export function interpretarPrecioCoingecko(json: unknown, id: string, hoy: Fecha): Cotizacion | null {
  const precio = (json as Record<string, { eur?: number }>)[id]?.eur;
  return typeof precio === "number" && precio > 0 ? { fecha: hoy, precio, moneda: "EUR" } : null;
}

export async function buscarCoingecko(texto: string, clave: string | null): Promise<ResultadoBusqueda[]> {
  return interpretarBusquedaCoingecko(await pedirJson(`${COINGECKO}/search?query=${encodeURIComponent(texto)}`, cabecerasCoingecko(clave)));
}

export async function cotizacionCoingecko(id: string, hoy: Fecha, clave: string | null): Promise<Cotizacion | null> {
  return interpretarPrecioCoingecko(await pedirJson(`${COINGECKO}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=eur`, cabecerasCoingecko(clave)), id, hoy);
}

// ── Tipos de cambio: Banco Central Europeo, con Frankfurter de respaldo ──

export interface TipoCambio {
  fecha: Fecha;
  /** Unidades de la moneda por 1 €. */
  porEuro: number;
}

export function interpretarBce(csv: string): Map<string, TipoCambio> {
  const { data } = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true });
  const tipos = new Map<string, TipoCambio>();
  for (const fila of data) {
    const valor = Number(fila.OBS_VALUE);
    if (!fila.CURRENCY || !fila.TIME_PERIOD || !(valor > 0)) continue;
    const anterior = tipos.get(fila.CURRENCY);
    if (!anterior || anterior.fecha < fila.TIME_PERIOD) tipos.set(fila.CURRENCY, { fecha: fila.TIME_PERIOD, porEuro: valor });
  }
  return tipos;
}

export function interpretarFrankfurter(json: unknown): Map<string, TipoCambio> {
  const { date, rates } = json as { date: string; rates: Record<string, number> };
  return new Map(Object.entries(rates ?? {}).map(([moneda, porEuro]) => [moneda, { fecha: date, porEuro }]));
}

export async function tiposDeCambio(monedas: readonly string[]): Promise<{ tipos: Map<string, TipoCambio>; fuente: string }> {
  if (!monedas.length) return { tipos: new Map(), fuente: "bce" };
  try {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${monedas.join("+")}.EUR.SP00.A?lastNObservations=1&format=csvdata`;
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
    if (!respuesta.ok) throw new Error(`BCE respondió ${respuesta.status}`);
    const tipos = interpretarBce(await respuesta.text());
    if (monedas.every((m) => tipos.has(m))) return { tipos, fuente: "bce" };
  } catch {
    // Se intenta con Frankfurter, que publica los mismos datos del BCE
  }
  return { tipos: interpretarFrankfurter(await pedirJson(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${monedas.join(",")}`)), fuente: "frankfurter" };
}
