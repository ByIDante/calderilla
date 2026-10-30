import type { BaseDatos } from "../datos/db.ts";
import type { Fecha } from "../dominio/fechas.ts";
import { leerActivos, type Activo } from "../servicios/cartera.ts";
import { cotizacionCoingecko, cotizacionYahoo, tiposDeCambio, type Cotizacion } from "./fuentes.ts";

export interface Informe {
  actualizados: string[];
  errores: string[];
}

export interface OpcionesActualizacion {
  hoy: Fecha;
  coingeckoClave: string | null;
}

/** Cada cuánto se actualizan solos los precios al abrir la app. */
export const ACTUALIZAR_CADA_MS = 12 * 3_600_000;

export async function cotizar(activo: Pick<Activo, "fuentePrecio" | "simboloFuente">, opciones: OpcionesActualizacion): Promise<Cotizacion | null> {
  if (!activo.simboloFuente) return null;
  if (activo.fuentePrecio === "yahoo") return cotizacionYahoo(activo.simboloFuente, opciones.hoy);
  if (activo.fuentePrecio === "coingecko") return cotizacionCoingecko(activo.simboloFuente, opciones.hoy, opciones.coingeckoClave);
  return null;
}

export function guardarCotizacion(bd: BaseDatos, activo: Pick<Activo, "id" | "fuentePrecio" | "moneda">, cotizacion: Cotizacion) {
  bd.ejecutar("INSERT OR REPLACE INTO precios (activo_id, fecha, precio, fuente) VALUES (?, ?, ?, ?)", activo.id, cotizacion.fecha, cotizacion.precio, activo.fuentePrecio);
  // La moneda buena es la del precio: si el activo se dio de alta con otra, se corrige
  if (cotizacion.moneda && cotizacion.moneda !== activo.moneda && /^[A-Z]{3}$/.test(cotizacion.moneda)) {
    bd.ejecutar("UPDATE activos SET moneda = ? WHERE id = ?", cotizacion.moneda, activo.id);
  }
}

/**
 * Actualiza los precios automáticos y los tipos de cambio. Va de uno en uno para no saturar las fuentes.
 * `bd` es una función porque, mientras se espera a la red, la copia local puede cambiar (llegan datos de otro ordenador).
 */
export async function actualizarPrecios(bd: () => BaseDatos, opciones: OpcionesActualizacion): Promise<Informe> {
  const informe: Informe = { actualizados: [], errores: [] };
  for (const activo of leerActivos(bd()).filter((a) => a.fuentePrecio !== "manual" && a.simboloFuente)) {
    try {
      const cotizacion = await cotizar(activo, opciones);
      if (!cotizacion) {
        informe.errores.push(`${activo.nombre}: la fuente no devolvió precio`);
        continue;
      }
      guardarCotizacion(bd(), activo, cotizacion);
      informe.actualizados.push(activo.nombre);
    } catch (error) {
      informe.errores.push(`${activo.nombre}: ${(error as Error).message}`);
    }
  }

  const monedas = bd()
    .todos<{ moneda: string }>("SELECT moneda FROM activos WHERE archivado = 0 UNION SELECT moneda FROM cuentas WHERE archivada = 0")
    .map((fila) => fila.moneda)
    .filter((moneda) => moneda !== "EUR" && /^[A-Z]{3}$/.test(moneda));
  if (monedas.length) {
    try {
      const { tipos, fuente } = await tiposDeCambio(monedas);
      for (const [moneda, tipo] of tipos) {
        if (!monedas.includes(moneda)) continue;
        bd().ejecutar("INSERT OR REPLACE INTO tipos_cambio (fecha, moneda, por_euro, fuente) VALUES (?, ?, ?, ?)", tipo.fecha, moneda, tipo.porEuro, fuente);
        informe.actualizados.push(`1 € en ${moneda}`);
      }
    } catch (error) {
      informe.errores.push(`Tipos de cambio: ${(error as Error).message}`);
    }
  }
  bd().escribirMeta("precios_actualizados", new Date().toISOString());
  return informe;
}

export function hayQueActualizar(bd: BaseDatos, ahora = Date.now()): boolean {
  const ultima = bd.leerMeta("precios_actualizados");
  const automaticos = bd.uno<{ n: number }>("SELECT count(*) AS n FROM activos WHERE archivado = 0 AND fuente_precio != 'manual'")?.n ?? 0;
  const extranjeras = bd.uno<{ n: number }>("SELECT count(*) AS n FROM activos WHERE archivado = 0 AND moneda != 'EUR'")?.n ?? 0;
  if (!automaticos && !extranjeras) return false;
  return !ultima || ahora - Date.parse(ultima) > ACTUALIZAR_CADA_MS;
}
