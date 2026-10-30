import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { carpetaAjustes } from "../config/ajustes.ts";
import type { BaseDatos } from "../datos/db.ts";
import { sumarDias, type Fecha } from "../dominio/fechas.ts";
import { guardarSaldo } from "../servicios/cuentas.ts";
import { importarDelBanco } from "../servicios/importacion.ts";
import { EnableBanking, type CuentaBanco } from "./enablebanking.ts";

/*
 * Bancos vinculados en ESTE ordenador. Se guardan en la carpeta de ajustes (no en la sincronizada): cada
 * ordenador vincula sus bancos con su propia clave. Ojo: algunos bancos solo permiten una sesión activa por
 * persona, así que vincular el mismo banco en los dos ordenadores puede desconectar el otro.
 */

export interface CuentaVinculada extends CuentaBanco {
  /** Cuenta de Calderilla donde van su saldo y sus movimientos; null si no se sincroniza. */
  cuentaId: number | null;
}

export interface Conexion {
  sessionId: string;
  banco: string;
  pais: string;
  validoHasta: string;
  cuentas: CuentaVinculada[];
  ultimaSincronizacion: string | null;
}

export interface ConfigBancos {
  appId: string | null;
  conexiones: Conexion[];
}

const archivo = () => path.join(carpetaAjustes(), "bancos.json");
const archivoClave = () => path.join(carpetaAjustes(), "enablebanking.pem");

export function leerBancos(): ConfigBancos {
  if (!existsSync(archivo())) return { appId: null, conexiones: [] };
  return JSON.parse(readFileSync(archivo(), "utf8")) as ConfigBancos;
}

export function guardarBancos(config: ConfigBancos) {
  const temporal = `${archivo()}.tmp`;
  writeFileSync(temporal, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporal, archivo());
}

export function guardarClave(pem: string) {
  writeFileSync(archivoClave(), pem, { mode: 0o600 });
}

export function hayClave(): boolean {
  return existsSync(archivoClave());
}

export function cliente(): EnableBanking | null {
  const { appId } = leerBancos();
  if (!appId || !hayClave()) return null;
  return new EnableBanking(appId, readFileSync(archivoClave(), "utf8"));
}

/** Días que faltan para que caduque el permiso de una conexión (negativo si ya caducó). */
export function diasParaCaducar(conexion: Conexion, ahora = Date.now()): number {
  return Math.floor((Date.parse(conexion.validoHasta) - ahora) / 86_400_000);
}

/** Cada cuánto se sincroniza solo al abrir la app (PSD2 limita los accesos sin que estés delante a 4 al día). */
export const SINCRONIZAR_CADA_MS = 12 * 3_600_000;

export function haySincronizacionPendiente(ahora = Date.now()): boolean {
  return leerBancos().conexiones.some(
    (c) => diasParaCaducar(c, ahora) >= 0 && c.cuentas.some((x) => x.cuentaId) && (!c.ultimaSincronizacion || ahora - Date.parse(c.ultimaSincronizacion) > SINCRONIZAR_CADA_MS),
  );
}

export interface InformeBancos {
  nuevos: number;
  cuentas: number;
  errores: string[];
}

/**
 * Trae saldos y movimientos de las cuentas vinculadas. La primera vez, los últimos 89 días (muchos bancos
 * no dan más); después, desde una semana antes de la última vez, por si llegó algún movimiento con retraso.
 */
export async function sincronizarBancos(bd: () => BaseDatos, hoy: Fecha): Promise<InformeBancos> {
  const informe: InformeBancos = { nuevos: 0, cuentas: 0, errores: [] };
  const api = cliente();
  if (!api) return informe;
  const config = leerBancos();
  for (const conexion of config.conexiones) {
    if (diasParaCaducar(conexion) < 0) {
      informe.errores.push(`${conexion.banco}: el permiso caducó, vuelve a vincularlo`);
      continue;
    }
    const desde = conexion.ultimaSincronizacion ? sumarDias(conexion.ultimaSincronizacion.slice(0, 10), -7) : sumarDias(hoy, -89);
    let todoBien = true;
    for (const cuenta of conexion.cuentas.filter((c) => c.cuentaId)) {
      try {
        const saldo = await api.saldo(cuenta.uid);
        if (saldo !== null) guardarSaldo(bd(), cuenta.cuentaId!, hoy, saldo, "banco");
        informe.nuevos += importarDelBanco(bd(), await api.movimientos(cuenta.uid, desde), cuenta.cuentaId!, hoy);
        informe.cuentas++;
      } catch (error) {
        todoBien = false;
        informe.errores.push(`${conexion.banco} ${cuenta.iban?.slice(-4) ?? ""}: ${(error as Error).message}`);
      }
    }
    if (todoBien) conexion.ultimaSincronizacion = new Date().toISOString();
  }
  // Mientras se esperaba a la red pudo cambiar la configuración (vincular, desvincular…): solo se apunta la hora
  const actual = leerBancos();
  for (const conexion of actual.conexiones) {
    const sincronizada = config.conexiones.find((x) => x.sessionId === conexion.sessionId);
    if (sincronizada) conexion.ultimaSincronizacion = sincronizada.ultimaSincronizacion;
  }
  guardarBancos(actual);
  return informe;
}
