import type { Hono } from "hono";
import { mesDe, nombreMes, nombreMesCorto, sumarDias, sumarMesesAMes } from "../../dominio/fechas.ts";
import { importeEn, ocurrencias } from "../../dominio/recurrencia.ts";
import { contexto } from "../../servicios/situacion.ts";
import { bd, render, type Estado } from "../app.ts";
import { vistaResumen } from "../vistas/resumen.ts";

export function rutasResumen(app: Hono, estado: Estado) {
  app.get("/", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    const ctx = contexto(base, hoy);
    const mes = mesDe(hoy);

    const cierres = base
      .todos<{ mes: string; ahorro_plan: number; ahorro_real: number | null }>("SELECT mes, ahorro_plan, ahorro_real FROM cierres_mes ORDER BY mes DESC LIMIT 12")
      .reverse();
    const mesAnterior = sumarMesesAMes(mes, -1);
    const cierrePendiente = ctx.cuentas.length > 0 && !base.uno("SELECT 1 FROM cierres_mes WHERE mes = ?", mesAnterior) ? mesAnterior : null;

    const proximos = ctx.recurrentes
      .filter((r) => r.frecuencia !== "mensual" && r.tipo === "gasto")
      .flatMap((r) => ocurrencias(r, hoy, sumarDias(hoy, 90)).map((fecha) => ({ nombre: r.nombre, fecha, importe: importeEn(r.versiones, fecha) })))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const porCategoria = new Map<string, number>();
    for (const linea of ctx.presupuesto.lineas.filter((l) => l.recurrente.tipo === "gasto")) {
      const nombre = linea.recurrente.categoria ?? "Sin categoría";
      porCategoria.set(nombre, (porCategoria.get(nombre) ?? 0) + linea.mensual);
    }

    return render(
      c,
      estado,
      { titulo: `Resumen de ${nombreMes(mes)}`, seccion: "resumen" },
      vistaResumen({
        ctx,
        cierrePendiente,
        proximos,
        cierres: cierres.map((cierre) => ({ etiqueta: nombreMesCorto(cierre.mes), plan: cierre.ahorro_plan, real: cierre.ahorro_real })),
        porCategoria: [...porCategoria].sort((a, b) => b[1] - a[1]),
      }),
    );
  });
}
