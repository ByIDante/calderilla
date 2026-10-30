import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import { sumarMesesAMes, ultimoDia, type Mes } from "../dominio/fechas.ts";
import { ocioSobrante } from "../reglas/ocio.ts";
import { guardarSaldo } from "./cuentas.ts";
import { provisiones } from "./finanzas.ts";
import { contexto, ocioGastadoEn } from "./situacion.ts";

export interface Cierre {
  mes: Mes;
  cerrado: string;
  ingresos: Centimos;
  gastos_esenciales: Centimos;
  gastos_no_esenciales: Centimos;
  ahorro_plan: Centimos;
  ahorro_real: Centimos | null;
  patrimonio: Centimos;
  liquidez_libre: Centimos;
  fondo_objetivo: Centimos;
  ocio_plan: Centimos;
  ocio_gastado: Centimos;
  ocio_sobrante: Centimos;
  etapa: string;
}

export function leerCierres(bd: BaseDatos, limite = 24): Cierre[] {
  return bd.todos<Cierre>("SELECT * FROM cierres_mes ORDER BY mes DESC LIMIT ?", limite);
}

/**
 * Cierra un mes: guarda los saldos a final de mes y congela lo previsto y lo real. El ahorro real es lo que
 * ha crecido tu patrimonio respecto al cierre anterior, medido:
 * - con la inversión a precio de compra, para que las subidas y bajadas de la bolsa no cuenten como ahorro;
 * - restando las deudas, para que devolver un préstamo cuente como ahorro;
 * - sin lo apartado para gastos anuales, que el presupuesto ya reparte mes a mes (si no, el mes del seguro
 *   parecería que no ahorras y los demás que ahorras de más).
 */
export function cerrarMes(bd: BaseDatos, mes: Mes, saldos: { cuentaId: number; saldo: Centimos }[]): Cierre {
  const fecha = ultimoDia(mes);
  return bd.transaccion(() => {
    for (const { cuentaId, saldo } of saldos) guardarSaldo(bd, cuentaId, fecha, saldo, "cierre");
    const ctx = contexto(bd, fecha);
    const p = ctx.resultado.presupuesto;
    const anterior = bd.uno<Cierre & { resumen: string | null }>("SELECT * FROM cierres_mes WHERE mes = ?", sumarMesesAMes(mes, -1));
    const gastado = ocioGastadoEn(bd, fecha);
    const patrimonio = ctx.patrimonioACoste - ctx.situacion.provisiones;
    // El cierre anterior se mide con los gastos fijos de ahora: si después añadiste un seguro anual, lo que
    // ya tendrías que llevar apartado para él no debe parecer «este mes ahorraste menos»
    const provisionesAntes = anterior ? (JSON.parse(anterior.resumen ?? "{}") as { provisiones?: number }).provisiones : undefined;
    const patrimonioAnterior =
      anterior && provisionesAntes !== undefined
        ? anterior.patrimonio + provisionesAntes - provisiones(ctx.recurrentes, ultimoDia(sumarMesesAMes(mes, -1)))
        : anterior?.patrimonio;
    const cierre: Cierre = {
      mes,
      cerrado: new Date().toISOString(),
      ingresos: p.ingresos,
      gastos_esenciales: p.esenciales,
      gastos_no_esenciales: p.noEsenciales,
      ahorro_plan: p.objetivoAhorro,
      ahorro_real: patrimonioAnterior === undefined ? null : patrimonio - patrimonioAnterior,
      patrimonio,
      liquidez_libre: ctx.resultado.liquidezLibre,
      fondo_objetivo: ctx.resultado.fondoObjetivo,
      ocio_plan: p.ocio + p.ocioRemanente,
      ocio_gastado: gastado,
      ocio_sobrante: ocioSobrante(p.ocio + p.ocioRemanente, gastado, ctx.parametros),
      etapa: ctx.resultado.etapa,
    };
    bd.ejecutar(
      `INSERT OR REPLACE INTO cierres_mes (mes, cerrado, ingresos, gastos_esenciales, gastos_no_esenciales, ahorro_plan, ahorro_real, patrimonio, liquidez_libre,
         fondo_objetivo, ocio_plan, ocio_gastado, ocio_sobrante, etapa, resumen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cierre.mes,
      cierre.cerrado,
      cierre.ingresos,
      cierre.gastos_esenciales,
      cierre.gastos_no_esenciales,
      cierre.ahorro_plan,
      cierre.ahorro_real,
      cierre.patrimonio,
      cierre.liquidez_libre,
      cierre.fondo_objetivo,
      cierre.ocio_plan,
      cierre.ocio_gastado,
      cierre.ocio_sobrante,
      cierre.etapa,
      JSON.stringify({ patrimonioMercado: ctx.patrimonio, provisiones: ctx.situacion.provisiones }),
    );
    return cierre;
  });
}
