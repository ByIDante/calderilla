import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import { sumarMeses, type Fecha } from "../dominio/fechas.ts";

export type TipoCuenta = "corriente" | "remunerada" | "monetario" | "deposito" | "letras" | "broker" | "efectivo" | "plan_pensiones" | "otra";

export const NOMBRE_TIPO_CUENTA: Record<TipoCuenta, string> = {
  corriente: "Cuenta corriente",
  remunerada: "Cuenta remunerada",
  monetario: "Fondo monetario",
  deposito: "Depósito a plazo",
  letras: "Letras del Tesoro",
  broker: "Efectivo en bróker",
  efectivo: "Efectivo",
  plan_pensiones: "Plan de pensiones",
  otra: "Otra",
};

/** Cuentas cuyo dinero está disponible enseguida. Depósitos y Letras solo cuentan si vencen pronto. */
const LIQUIDAS: TipoCuenta[] = ["corriente", "remunerada", "monetario", "broker", "efectivo"];
const A_PLAZO: TipoCuenta[] = ["deposito", "letras"];

export interface Cuenta {
  id: number;
  nombre: string;
  tipo: TipoCuenta;
  entidad: string | null;
  moneda: string;
  tae: number | null;
  vencimiento: Fecha | null;
  archivada: boolean;
  saldo: Centimos;
  saldoFecha: Fecha | null;
}

/** Cuentas con su último saldo conocido hasta `fecha`. */
export function leerCuentas(bd: BaseDatos, fecha: Fecha, incluirArchivadas = false): Cuenta[] {
  return bd
    .todos<{ id: number; nombre: string; tipo: TipoCuenta; entidad: string | null; moneda: string; tae: number | null; vencimiento: string | null; archivada: number; saldo: number | null; saldo_fecha: string | null }>(
      `SELECT c.*, s.saldo, s.fecha AS saldo_fecha FROM cuentas c
       LEFT JOIN saldos s ON s.id = (SELECT id FROM saldos WHERE cuenta_id = c.id AND fecha <= ? ORDER BY fecha DESC, id DESC LIMIT 1)
       ${incluirArchivadas ? "" : "WHERE c.archivada = 0"} ORDER BY c.archivada, c.tipo, c.nombre`,
      fecha,
    )
    .map((fila) => ({ ...fila, archivada: fila.archivada === 1, saldo: fila.saldo ?? 0, saldoFecha: fila.saldo_fecha }));
}

export function esLiquida(cuenta: Cuenta, fecha: Fecha): boolean {
  if (LIQUIDAS.includes(cuenta.tipo)) return true;
  return A_PLAZO.includes(cuenta.tipo) && (!cuenta.vencimiento || cuenta.vencimiento <= sumarMeses(fecha, 3));
}

export function esAhorro(cuenta: Cuenta): boolean {
  return LIQUIDAS.includes(cuenta.tipo) || A_PLAZO.includes(cuenta.tipo);
}

export function guardarSaldo(bd: BaseDatos, cuentaId: number, fecha: Fecha, saldo: Centimos, origen = "manual") {
  bd.ejecutar(
    "INSERT INTO saldos (cuenta_id, fecha, saldo, origen) VALUES (?, ?, ?, ?) ON CONFLICT (cuenta_id, fecha) DO UPDATE SET saldo = excluded.saldo, origen = excluded.origen",
    cuentaId,
    fecha,
    saldo,
    origen,
  );
}
