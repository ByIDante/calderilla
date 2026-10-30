import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import type { Fecha } from "../dominio/fechas.ts";

export type TipoActivo = "fondo" | "etf" | "accion" | "cripto" | "divisa" | "otro";
export type Renta = "variable" | "fija" | "monetario";

export const NOMBRE_TIPO_ACTIVO: Record<TipoActivo, string> = {
  fondo: "Fondo de inversión",
  etf: "ETF",
  accion: "Acción",
  cripto: "Criptomoneda",
  divisa: "Divisa",
  otro: "Otro",
};

export const NOMBRE_RENTA: Record<Renta, string> = { variable: "Renta variable (bolsa)", fija: "Renta fija", monetario: "Monetario" };

export interface Activo {
  id: number;
  nombre: string;
  isin: string | null;
  simbolo: string | null;
  tipo: TipoActivo;
  renta: Renta;
  moneda: string;
  especulativo: boolean;
  fuentePrecio: string;
  simboloFuente: string | null;
  archivado: boolean;
}

export interface Posicion {
  activo: Activo;
  cantidad: number;
  /** Lo pagado por lo que aún tienes, en euros, con comisiones (coste medio). */
  coste: Centimos;
  precio: { precio: number; fecha: Fecha; fuente: string } | null;
  /** Unidades de la moneda del activo por euro; null si falta el tipo de cambio. */
  porEuro: number | null;
  /** Valor en euros; si no hay precio, se usa el coste. */
  valor: Centimos;
  sinPrecio: boolean;
}

export function esEspeculativo(activo: Pick<Activo, "tipo" | "especulativo">): boolean {
  return activo.especulativo || activo.tipo === "cripto" || activo.tipo === "divisa";
}

export function leerActivos(bd: BaseDatos, incluirArchivados = false): Activo[] {
  return bd
    .todos<{ id: number; nombre: string; isin: string | null; simbolo: string | null; tipo: TipoActivo; renta: Renta; moneda: string; especulativo: number; fuente_precio: string; simbolo_fuente: string | null; archivado: number }>(
      `SELECT * FROM activos ${incluirArchivados ? "" : "WHERE archivado = 0"} ORDER BY tipo, nombre`,
    )
    .map((fila) => ({
      id: fila.id,
      nombre: fila.nombre,
      isin: fila.isin,
      simbolo: fila.simbolo,
      tipo: fila.tipo,
      renta: fila.renta,
      moneda: fila.moneda,
      especulativo: fila.especulativo === 1,
      fuentePrecio: fila.fuente_precio,
      simboloFuente: fila.simbolo_fuente,
      archivado: fila.archivado === 1,
    }));
}

/** El tipo de cambio más reciente hasta `fecha`: cuántas unidades de `moneda` da 1 €. */
export function tipoCambio(bd: BaseDatos, moneda: string, fecha: Fecha): number | null {
  if (moneda === "EUR") return 1;
  return bd.uno<{ por_euro: number }>("SELECT por_euro FROM tipos_cambio WHERE moneda = ? AND fecha <= ? ORDER BY fecha DESC LIMIT 1", moneda, fecha)?.por_euro ?? null;
}

/** El precio más reciente hasta `fecha`. Si ese día hay uno manual y otro automático, gana el manual. */
export function ultimoPrecio(bd: BaseDatos, activoId: number, fecha: Fecha): Posicion["precio"] {
  return (
    bd.uno<{ precio: number; fecha: string; fuente: string }>(
      "SELECT precio, fecha, fuente FROM precios WHERE activo_id = ? AND fecha <= ? ORDER BY fecha DESC, (fuente = 'manual') DESC LIMIT 1",
      activoId,
      fecha,
    ) ?? null
  );
}

export function leerCartera(bd: BaseDatos, fecha: Fecha): Posicion[] {
  const movimientos = bd.todos<{ activo_id: number; tipo: "compra" | "venta"; cantidad: number; importe: number }>(
    "SELECT activo_id, tipo, cantidad, importe FROM movimientos_cartera WHERE fecha <= ? ORDER BY fecha, id",
    fecha,
  );
  return leerActivos(bd).map((activo) => {
    let cantidad = 0;
    let coste = 0;
    for (const m of movimientos) {
      if (m.activo_id !== activo.id) continue;
      if (m.tipo === "compra") {
        cantidad += m.cantidad;
        coste += m.importe;
      } else if (cantidad > 0) {
        // Coste medio: al vender, sale la parte proporcional de lo pagado
        coste -= Math.round(coste * Math.min(m.cantidad / cantidad, 1));
        cantidad = Math.max(cantidad - m.cantidad, 0);
      }
    }
    // Una divisa vale 1 en su propia moneda; lo que cambia es el tipo de cambio
    const precio = activo.tipo === "divisa" ? { precio: 1, fecha, fuente: "divisa" } : ultimoPrecio(bd, activo.id, fecha);
    const porEuro = tipoCambio(bd, activo.moneda, fecha);
    const valorado = precio && porEuro ? Math.round((cantidad * precio.precio * 100) / porEuro) : null;
    return { activo, cantidad, coste, precio, porEuro, valor: valorado ?? coste, sinPrecio: valorado === null };
  });
}
