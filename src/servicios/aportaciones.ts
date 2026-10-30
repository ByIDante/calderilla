import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import { diasDelMes, mesDe, type Fecha, type Mes } from "../dominio/fechas.ts";
import { tipoCambio, ultimoPrecio } from "./cartera.ts";

/*
 * Ahorro automático: el traspaso de cada mes a tu cuenta de ahorro (p. ej. Trade Republic) o la compra
 * periódica de un fondo. No es un gasto, es ahorro: la escalera ya lo cuenta al ver crecer tus saldos.
 * Apuntarlo sirve para comparar con lo que pide la regla y, al cerrar el mes, para ver si se hizo.
 * Saltarse un mes no rompe nada: el objetivo sigue igual y solo se retrasa la fecha estimada.
 */

export interface Aportacion {
  id: number;
  nombre: string;
  cuentaId: number | null;
  activoId: number | null;
  /** Nombre de la cuenta o del fondo de destino. */
  destino: string;
  importe: Centimos;
  dia: number;
  inicio: Fecha;
  fin: Fecha | null;
}

export function leerAportaciones(bd: BaseDatos): Aportacion[] {
  return bd
    .todos<{ id: number; nombre: string; cuenta_id: number | null; activo_id: number | null; destino: string | null; importe: number; dia: number; inicio: string; fin: string | null }>(
      `SELECT a.*, coalesce(c.nombre, x.nombre) AS destino FROM aportaciones a
       LEFT JOIN cuentas c ON c.id = a.cuenta_id LEFT JOIN activos x ON x.id = a.activo_id ORDER BY a.fin IS NOT NULL, a.nombre`,
    )
    .map((f) => ({ id: f.id, nombre: f.nombre, cuentaId: f.cuenta_id, activoId: f.activo_id, destino: f.destino ?? "?", importe: f.importe, dia: f.dia, inicio: f.inicio, fin: f.fin }));
}

export function activaEn(a: Pick<Aportacion, "inicio" | "fin">, mes: Mes): boolean {
  return mesDe(a.inicio) <= mes && (!a.fin || mesDe(a.fin) >= mes);
}

export function totalMensual(aportaciones: readonly Aportacion[], mes: Mes): Centimos {
  return aportaciones.filter((a) => activaEn(a, mes)).reduce((s, a) => s + a.importe, 0);
}

/** Lo registrado en los cierres: aportación → mes → importe aportado. */
export function historial(bd: BaseDatos): Map<number, Map<Mes, Centimos>> {
  const mapa = new Map<number, Map<Mes, Centimos>>();
  for (const f of bd.todos<{ aportacion_id: number; mes: string; importe: number }>("SELECT aportacion_id, mes, importe FROM aportaciones_mes")) {
    if (!mapa.has(f.aportacion_id)) mapa.set(f.aportacion_id, new Map());
    mapa.get(f.aportacion_id)!.set(f.mes, f.importe);
  }
  return mapa;
}

export interface Hecha {
  id: number;
  importe: Centimos;
  /** Participaciones compradas, si se saben (solo fondos). */
  cantidad: number | null;
}

export interface ResultadoMes {
  omitidas: Aportacion[];
  menores: { aportacion: Aportacion; importe: Centimos }[];
  /** Fondos sin precio para calcular las participaciones: hay que apuntar la compra a mano. */
  sinPrecio: string[];
}

/**
 * Apunta lo aportado en un mes. Si el destino es un fondo, crea (o actualiza) la compra correspondiente,
 * calculando las participaciones con el último precio si no se indican.
 */
export function registrarMes(bd: BaseDatos, mes: Mes, hechas: readonly Hecha[]): ResultadoMes {
  const aportaciones = new Map(leerAportaciones(bd).map((a) => [a.id, a]));
  const resultado: ResultadoMes = { omitidas: [], menores: [], sinPrecio: [] };
  bd.transaccion(() => {
    for (const hecha of hechas) {
      const a = aportaciones.get(hecha.id);
      if (!a || !activaEn(a, mes)) continue;
      const [anio, numeroMes] = mes.split("-").map(Number) as [number, number];
      const fecha = `${mes}-${String(Math.min(a.dia, diasDelMes(anio, numeroMes))).padStart(2, "0")}`;
      const previa = bd.uno<{ movimiento_id: number | null }>("SELECT movimiento_id FROM aportaciones_mes WHERE aportacion_id = ? AND mes = ?", a.id, mes);
      let movimiento = previa?.movimiento_id ?? null;
      if (movimiento) bd.ejecutar("DELETE FROM movimientos_cartera WHERE id = ?", movimiento);
      movimiento = null;
      if (a.activoId && hecha.importe > 0) {
        let cantidad = hecha.cantidad;
        if (!cantidad) {
          const precio = ultimoPrecio(bd, a.activoId, fecha);
          const moneda = bd.uno<{ moneda: string }>("SELECT moneda FROM activos WHERE id = ?", a.activoId)?.moneda ?? "EUR";
          const porEuro = tipoCambio(bd, moneda, fecha);
          cantidad = precio && porEuro ? (hecha.importe / 100) * (porEuro / precio.precio) : null;
        }
        if (cantidad) {
          movimiento = bd.ejecutar("INSERT INTO movimientos_cartera (activo_id, fecha, tipo, cantidad, importe) VALUES (?, ?, 'compra', ?, ?)", a.activoId, fecha, cantidad, hecha.importe).id;
        } else {
          resultado.sinPrecio.push(a.destino);
        }
      }
      bd.ejecutar(
        "INSERT INTO aportaciones_mes (aportacion_id, mes, importe, movimiento_id) VALUES (?, ?, ?, ?) ON CONFLICT (aportacion_id, mes) DO UPDATE SET importe = excluded.importe, movimiento_id = excluded.movimiento_id",
        a.id,
        mes,
        hecha.importe,
        movimiento,
      );
      if (hecha.importe === 0) resultado.omitidas.push(a);
      else if (hecha.importe < a.importe) resultado.menores.push({ aportacion: a, importe: hecha.importe });
    }
  });
  return resultado;
}
