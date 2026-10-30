// Movimientos de ejemplo de dos bancos para los tests de «Encontrado en tus movimientos».
import type { BaseDatos } from "../src/datos/db.ts";
import { indiceMes, mesDesdeIndice, sumarDias, type Fecha } from "../src/dominio/fechas.ts";
import type { ApunteDetectable } from "../src/importar/periodicos.ts";

/**
 * 14 meses de dos bancos (sep 2025 – oct 2026) con conceptos como los de verdad. Cuenta 1: BBVA (nómina y
 * gastos); cuenta 2: Trade Republic (recibe el ahorro). Categorías: 1 Alimentación, 2 Transporte, 3 Seguros.
 */
export function movimientosDeEjemplo(): ApunteDetectable[] {
  const lista: ApunteDetectable[] = [];
  const apuntar = (fecha: Fecha, importe: number, concepto: string, categoriaId: number | null = null, cuentaId = 1) =>
    lista.push({ id: lista.length + 1, fecha, importe, concepto, categoriaId, cuentaId });
  const meses = Array.from({ length: 14 }, (_, i) => mesDesdeIndice(indiceMes("2025-09") + i));
  meses.forEach((mes, i) => {
    // Nómina: llega entre el 27 y el 2 del mes siguiente
    const diaNomina = ["27", "28", "30", "29", "27"][i % 5]!;
    apuntar(i % 4 === 3 ? sumarDias(`${mes}-28`, 4) : `${mes}-${diaNomina}`, 215000, "ABONO NOMINA EMPRESA SL");
    apuntar(`${mes}-0${1 + (i % 3)}`, -75000, "TRANSFERENCIA A FAVOR DE JUAN PROPIETARIO ALQUILER");
    apuntar(`${mes}-12`, mes >= "2026-07" ? -1599 : -1399, `COMPRA TARJ 4589 NETFLIX.COM ${mes}`);
    apuntar(`${mes}-05`, -299, "APPLE.COM/BILL ITUNES.COM");
    apuntar(`${mes}-20`, -1099, "APPLE.COM/BILL ITUNES.COM");
    if (i % 2 === 0) apuntar(`${mes}-15`, -(8000 + ((i * 1700) % 4000)), "RECIBO IBERDROLA CLIENTES SAU FACTURA");
    if (["01", "04", "07", "10"].includes(mes.slice(5))) apuntar(`${mes}-10`, -9000, "RECIBO COMUNIDAD PROPIETARIOS");
    apuntar(`${mes}-03`, -28652, "RECIBO PRESTAMO 0123456");
    if (mes <= "2026-03") apuntar(`${mes}-08`, -1099, "SPOTIFY P1234");
    // Ahorro: sale de BBVA y entra en Trade Republic al día siguiente
    apuntar(`${mes}-01`, -30000, "TRANSFERENCIA A TRADE REPUBLIC");
    apuntar(`${mes}-02`, 30000, "Ingreso", null, 2);
    // El súper cada semana y la gasolina cada 10 días, con importes que varían
    for (const dia of ["04", "11", "18", "25"]) apuntar(`${mes}-${dia}`, -(3000 + ((Number(dia) * 7 + i * 13) % 60) * 100), "COMPRA TARJ 4589 MERCADONA VALENCIA", 1);
    for (const dia of ["06", "16", "26"]) apuntar(`${mes}-${dia}`, -(4000 + ((Number(dia) + i) % 3) * 500), "COMPRA TARJ 4589 REPSOL ESTACION", 2);
  });
  apuntar("2025-10-03", -41235, "RECIBO MAPFRE SEGUROS POLIZA 99887", 3);
  apuntar("2026-10-05", -41235, "RECIBO MAPFRE SEGUROS POLIZA 99887", 3);
  apuntar("2026-03-14", -4999, "COMPRA TARJ 4589 AMAZON MARKETPLACE");
  apuntar("2026-03-24", 4999, "DEVOLUCION COMPRA AMAZON MARKETPLACE");
  apuntar("2026-04-14", -4999, "COMPRA TARJ 4589 AMAZON MARKETPLACE");
  apuntar("2026-05-14", -4999, "COMPRA TARJ 4589 AMAZON MARKETPLACE");
  apuntar("2026-09-19", -2000, "BIZUM A JUAN");
  apuntar("2026-08-20", -38000, "RECIBO GENERALI SEGUROS HOGAR", 3);
  return lista;
}

/** Carga los movimientos de ejemplo en una base, con sus dos cuentas (BBVA y Trade Republic) y categorías reales. */
export function cargarEjemplo(bd: BaseDatos): { bbva: number; tr: number } {
  const cat = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
  const bbva = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad) VALUES ('Nómina', 'corriente', 'BBVA')").id;
  const tr = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad) VALUES ('Ahorro', 'remunerada', 'Trade Republic')").id;
  const categorias: Record<number, number> = { 1: cat("Alimentación"), 2: cat("Transporte"), 3: cat("Seguros") };
  for (const a of movimientosDeEjemplo()) {
    bd.ejecutar(
      "INSERT INTO apuntes (fecha, importe, concepto, categoria_id, cuenta_id, origen) VALUES (?, ?, ?, ?, ?, 'csv')",
      a.fecha,
      a.importe,
      a.concepto,
      a.categoriaId === null ? null : categorias[a.categoriaId]!,
      a.cuentaId === 2 ? tr : bbva,
    );
  }
  return { bbva, tr };
}
