import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { BaseDatos } from "../src/datos/db.ts";
import type { Fecha } from "../src/dominio/fechas.ts";
import { mensualEn } from "../src/dominio/recurrencia.ts";
import { casaPatron, claveConcepto, detectarPeriodicos, emparejarTraspasos, estimacionesPorCategoria, type ApunteDetectable } from "../src/importar/periodicos.ts";
import { crearRecurrente, leerRecurrentes } from "../src/servicios/finanzas.ts";
import { proponer } from "../src/servicios/importacion.ts";
import { aceptarPropuestas, calcularPropuestas, ignorarPropuesta, marcarTraspasos } from "../src/servicios/periodicos.ts";
import { prepararBase } from "../src/servicios/semillas.ts";
import { ocioGastadoEn } from "../src/servicios/situacion.ts";
import { cargarEjemplo, movimientosDeEjemplo } from "./movimientos-ejemplo.ts";

describe("la clave de un concepto", () => {
  it("se queda con quién cobra, sin cifras, meses ni palabras de canal", () => {
    assert.equal(claveConcepto("COMPRA TARJ 4589 NETFLIX.COM 12/10").clave, "netflix");
    assert.equal(claveConcepto("RECIBO NETFLIX.COM").clave, "netflix");
    assert.equal(claveConcepto("ABONO NOMINA EMPRESA SL OCTUBRE").clave, "nomina empresa");
    assert.equal(claveConcepto("RECIBO IBERDROLA CLIENTES SAU FACTURA PERIODO 01/09-31/10").clave, "iberdrola clientes");
    assert.equal(claveConcepto("Netflix monthly · NETFLIX INTERNATIONAL BV").clave, "netflix international", "del banco: manda quien cobra");
    assert.equal(claveConcepto("TRANSFERENCIA REALIZADA").clave, "", "sin nada fiable no se agrupa");
    assert.equal(claveConcepto("REINTEGRO CAJERO 1234").clave, "");
    assert.equal(claveConcepto("COMPRA TARJ 4589 NETFLIX.COM").canal, "tarjeta");
    assert.equal(claveConcepto("RECIBO IBERDROLA").canal, "recibo");
  });

  it("un patrón casa con palabras enteras", () => {
    assert.ok(casaPatron("netflix", "COMPRA TARJ NETFLIX.COM"));
    assert.ok(!casaPatron("dia", "COMPRA DIARIO LEVANTE"));
    assert.ok(casaPatron("iberdrola clientes", "RECIBO IBERDROLA CLIENTES SAU"));
    assert.ok(!casaPatron("iberdrola clientes", "IBERDROLA RENOVABLES"));
  });
});

describe("cargos que se repiten", () => {
  const apuntes = movimientosDeEjemplo();
  const traspasos = new Set(emparejarTraspasos(apuntes, new Map([[1, "BBVA"], [2, "Trade Republic"]])).flat());
  const ultimo = new Map<number | null, Fecha>([[1, "2026-10-28"], [2, "2026-10-02"]]);
  const encontrados = detectarPeriodicos(
    apuntes.filter((a) => !traspasos.has(a.id)),
    ultimo,
    new Set([3]),
  );
  const buscar = (nombre: string) => encontrados.filter((p) => p.nombre.toLowerCase().startsWith(nombre));

  it("encuentra los traspasos a Trade Republic y nada más", () => {
    assert.equal(traspasos.size, 28, "14 meses × (salida + entrada)");
  });

  it("nómina, alquiler, suscripciones, préstamo, comunidad y seguro", () => {
    const [nomina] = buscar("nomina");
    assert.deepEqual([nomina?.tipo, nomina?.frecuencia, nomina?.clase, nomina?.importe], ["ingreso", "mensual", "fijo", 215000]);
    assert.ok(["27", "28", "29", "30"].includes(nomina!.inicio.slice(8)), `la nómina se ancla a final de mes (${nomina!.inicio})`);
    const [alquiler] = buscar("juan propietario");
    assert.deepEqual([alquiler?.frecuencia, alquiler?.importe, alquiler?.canal], ["mensual", 75000, "transferencia"]);
    const [netflix] = buscar("netflix");
    assert.deepEqual([netflix?.clase, netflix?.importe], ["fijo", 1599], "con el precio nuevo");
    assert.deepEqual(netflix?.escalones.map((e) => e.importe), [1399, 1599], "y el cambio de precio, para no tocar los meses pasados");
    assert.equal(netflix?.escalones[1]?.desde, "2026-07-12");
    assert.deepEqual(buscar("apple").map((p) => p.importe).sort((a, b) => a - b), [299, 1099], "iCloud y Apple Music, por separado");
    assert.deepEqual(buscar("prestamo").map((p) => p.importe), [28652]);
    const [comunidad] = buscar("comunidad");
    assert.equal(comunidad?.frecuencia, "trimestral");
    const [mapfre] = buscar("mapfre");
    assert.deepEqual([mapfre?.frecuencia, mapfre?.unico], ["anual", false]);
  });

  it("la luz cada 2 meses va como mensual estimado a mitad de importe", () => {
    const [luz] = buscar("iberdrola");
    assert.deepEqual([luz?.meses, luz?.frecuencia, luz?.clase], [2, "mensual", "estimacion"]);
    assert.equal(luz?.mensual, Math.round(luz!.importe / 2));
  });

  it("un seguro suelto se pregunta como posible anual", () => {
    const [generali] = buscar("generali");
    assert.deepEqual([generali?.unico, generali?.frecuencia, generali?.importe], [true, "anual", 38000]);
  });

  it("no confunde con algo fijo el súper, la gasolina, lo cancelado, lo devuelto ni un Bizum suelto", () => {
    for (const nombre of ["mercadona", "repsol", "spotify", "amazon", "bizum", "trade", "ingreso"]) assert.deepEqual(buscar(nombre), [], nombre);
  });

  it("si el extracto es antiguo, lo de entonces sigue contando como activo", () => {
    const viejo = apuntes.filter((a) => a.fecha <= "2026-03-31" && !traspasos.has(a.id));
    const conViejo = detectarPeriodicos(viejo, new Map([[1, "2026-03-31"]]));
    assert.ok(conViejo.some((p) => p.nombre.toLowerCase().startsWith("spotify")));
  });
});

describe("gasto variable de cada mes", () => {
  it("mediana de los últimos 3 meses completos importados, por categoría", () => {
    const apuntes = movimientosDeEjemplo().filter((a) => a.categoriaId === 1 || a.categoriaId === 2);
    const estimaciones = estimacionesPorCategoria(apuntes, { desde: "2025-09-01", hasta: "2026-10-28" });
    const comida = estimaciones.find((e) => e.categoriaId === 1)!;
    assert.deepEqual(comida.meses.map((m) => m.mes), ["2026-07", "2026-08", "2026-09"], "octubre aún no ha terminado");
    const totales = comida.meses.map((m) => m.total).sort((a, b) => a - b);
    assert.equal(comida.mensual, totales[1]);
    assert.ok(estimaciones.some((e) => e.categoriaId === 2));
    assert.deepEqual(estimacionesPorCategoria(apuntes, { desde: "2026-08-15", hasta: "2026-10-10" }), [], "con un solo mes completo no se estima");
  });
});

describe("traspasos entre tus cuentas", () => {
  const cuenta = (id: number, fecha: string, importe: number, concepto: string, cuentaId: number): ApunteDetectable => ({ id, fecha, importe, concepto, categoriaId: null, cuentaId });
  it("empareja lo que sale de una y entra en otra, y no una compra con un Bizum", () => {
    const entidades = new Map([[1, "BBVA"], [2, "Openbank"]]);
    const parejas = emparejarTraspasos(
      [
        cuenta(1, "2026-10-01", -50000, "TRANSFERENCIA A OPENBANK", 1),
        cuenta(2, "2026-10-02", 50000, "TRANSFERENCIA RECIBIDA IVAN", 2),
        cuenta(3, "2026-10-05", -2000, "COMPRA TARJ BAR PEPE", 1),
        cuenta(4, "2026-10-05", 2000, "BIZUM DE MARIA", 2),
        cuenta(5, "2026-10-07", -10000, "TRANSFERENCIA A JUAN", 1),
        cuenta(6, "2026-10-08", 10000, "TRANSFERENCIA DE JUAN", 1),
      ],
      entidades,
    );
    assert.deepEqual(parejas, [[1, 2]], "la de Juan es en la misma cuenta: no es un traspaso tuyo");
  });
});

describe("encontrado en tus movimientos (con la base de datos)", () => {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-periodicos-"));
  after(() => rmSync(carpeta, { recursive: true, force: true }));
  const bd = new BaseDatos(path.join(carpeta, "datos.db"));
  prepararBase(bd);
  const cat = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
  const { bbva, tr } = cargarEjemplo(bd);
  const fijo = { fin: null, esencial: true, nota: null, frecuencia: "mensual" as const };
  // Lo que ya tenías apuntado a mano: el alquiler (desde junio), el préstamo del coche y la comida estimada
  const alquiler = crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Alquiler", categoriaId: cat("Vivienda"), inicio: "2026-06-01", clase: "fijo", importe: 75000, prestamo: null });
  const coche = crearRecurrente(bd, {
    ...fijo,
    tipo: "gasto",
    nombre: "Coche",
    categoriaId: cat("Transporte"),
    inicio: "2024-03-03",
    clase: "fijo",
    importe: 0,
    prestamo: { capital: 1_500_000, tin: 5.5, tae: null, plazoMeses: 60, comisionAmortizacion: 0, vinculado: false },
  });
  crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Comida", categoriaId: cat("Alimentación"), inicio: "2025-01-01", clase: "estimacion", importe: 60000, prestamo: null });
  const HOY = "2026-10-30";

  it("marca los traspasos a Trade Republic una sola vez y respeta lo que decides a mano", () => {
    assert.equal(marcarTraspasos(bd, HOY), 14);
    assert.equal(marcarTraspasos(bd, HOY), 0);
    const octubre = bd.todos<{ id: number }>("SELECT id FROM apuntes WHERE traspaso = 1 AND fecha BETWEEN '2026-10-01' AND '2026-10-31'").map((x) => x.id);
    assert.equal(octubre.length, 2);
    // Un traspaso con categoría de ocio no cuenta como ocio gastado
    bd.ejecutar("UPDATE apuntes SET categoria_id = ? WHERE id = ?", cat("Ocio"), octubre[0]!);
    assert.equal(ocioGastadoEn(bd, "2026-10-31"), 0);
    bd.ejecutar("UPDATE apuntes SET categoria_id = NULL WHERE id = ?", octubre[0]!);
  });

  it("propone crear lo nuevo y unir lo que ya tenías, sin duplicar", () => {
    const p = calcularPropuestas(bd, HOY);
    const gasto = (nombre: string) => p.gastos.find((x) => x.periodico.nombre.toLowerCase().startsWith(nombre));
    assert.deepEqual([gasto("juan propietario")?.accion, gasto("juan propietario")?.recurrente?.id, gasto("juan propietario")?.vinculables], ["vincular", alquiler, 5]);
    assert.deepEqual([gasto("prestamo")?.accion, gasto("prestamo")?.recurrente?.id], ["vincular", coche]);
    assert.equal(gasto("netflix")?.accion, "crear");
    assert.equal(p.ingresos[0]?.periodico.nombre, "Nomina empresa");
    assert.deepEqual(p.ahorros.map((a) => [a.destino.id, a.periodico.importe]), [[tr, 30000]], "el traspaso mensual, como ahorro automático");
    assert.ok(p.anuales.some((x) => x.periodico.nombre.startsWith("Generali")));
    const comida = p.estimaciones.find((e) => e.categoria === "Alimentación");
    assert.equal(comida?.actual?.nombre, "Comida", "la comida ya estimada se propone actualizar, no duplicar");
    assert.ok(p.estimaciones.some((e) => e.categoria === "Transporte" && !e.actual));
    assert.ok(!p.estimaciones.some((e) => e.categoria === "Vivienda"), "el alquiler es periódico: no es gasto variable");
  });

  it("lo que ignoras no vuelve a salir", () => {
    const icloud = calcularPropuestas(bd, HOY).gastos.find((x) => x.periodico.importe === 299)!;
    assert.ok(ignorarPropuesta(bd, HOY, icloud.id));
    assert.ok(!calcularPropuestas(bd, HOY).gastos.some((x) => x.periodico.importe === 299));
  });

  it("al aceptarlo todo, crea y une sin tocar los meses pasados, y ya no queda nada que proponer", () => {
    const p = calcularPropuestas(bd, HOY);
    const todas = [...p.gastos, ...p.ingresos, ...p.anuales, ...p.ahorros, ...p.precios, ...p.estimaciones].map((x) => ({ id: x.id }));
    const r = aceptarPropuestas(bd, HOY, todas);
    assert.deepEqual(r.errores, []);
    assert.equal(r.vinculados, 2);
    assert.equal(r.ahorros, 1);
    const netflix = leerRecurrentes(bd).find((x) => x.nombre === "Netflix")!;
    assert.equal(netflix.patron, "netflix");
    assert.equal(mensualEn(netflix, netflix.versiones, "2026-03"), 1399, "en marzo costaba lo de antes");
    assert.equal(mensualEn(netflix, netflix.versiones, "2026-10"), 1599);
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM apuntes WHERE recurrente_id = ?", netflix.id)?.n, 14);
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM apuntes WHERE recurrente_id = ?", alquiler)?.n, 5, "solo los cargos desde que empieza tu alquiler");
    assert.equal(leerRecurrentes(bd, alquiler)[0]?.patron, "juan propietario");
    assert.ok(bd.uno("SELECT 1 FROM aportaciones WHERE cuenta_id = ? AND importe = 30000", tr));
    assert.equal(calcularPropuestas(bd, HOY).total, 0);
  });

  it("la siguiente importación reconoce los cargos por su texto, aunque suban de precio", () => {
    const [netflix, mercadona] = proponer(
      bd,
      [
        { fila: 1, fecha: "2026-11-13", importe: -1799, concepto: "COMPRA TARJ 4589 NETFLIX.COM" },
        { fila: 2, fecha: "2026-11-12", importe: -1599, concepto: "COMPRA TARJ 4589 MERCADONA VALENCIA" },
      ],
      bbva,
    );
    assert.equal(netflix?.recurrente, "Netflix");
    assert.equal(mercadona?.recurrente, null, "otra tienda con el mismo importe no es Netflix");
    // Dos cargos seguidos al precio nuevo: se propone actualizarlo
    const id = leerRecurrentes(bd).find((x) => x.nombre === "Netflix")!.id;
    for (const fecha of ["2026-11-12", "2026-12-12"]) {
      bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, cuenta_id, recurrente_id, origen) VALUES (?, -1799, 'COMPRA TARJ NETFLIX.COM', ?, ?, 'csv')", fecha, bbva, id);
    }
    const precios = calcularPropuestas(bd, "2026-12-30").precios;
    assert.deepEqual(
      precios.map((x) => [x.recurrente.id, x.antes, x.ahora, x.desde]),
      [[id, 1599, 1799, "2026-11-12"]],
    );
  });
});

describe("parecidos que no son lo mismo", () => {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-parecidos-"));
  after(() => rmSync(carpeta, { recursive: true, force: true }));
  const bd = new BaseDatos(path.join(carpeta, "datos.db"));
  prepararBase(bd);
  const cat = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
  const base = { fin: null, esencial: false, nota: null, frecuencia: "mensual" as const, clase: "fijo" as const, prestamo: null, inicio: "2026-01-01" };
  const netflix = crearRecurrente(bd, { ...base, tipo: "gasto", nombre: "Netflix", categoriaId: cat("Suscripciones"), importe: 1399 });
  const luz = crearRecurrente(bd, { ...base, tipo: "gasto", nombre: "Luz y gas", categoriaId: cat("Suministros"), importe: 5000, esencial: true });
  for (const [i, mes] of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].entries()) {
    bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id, origen) VALUES (?, -1099, 'COMPRA TARJ SPOTIFY P3F2', ?, 'csv')", `${mes}-07`, cat("Suscripciones"));
    bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id, origen) VALUES (?, ?, 'RECIBO IBERDROLA CLIENTES', ?, 'csv')", `${mes}-14`, -(4500 + i * 200), cat("Suministros"));
  }

  it("Spotify no se une a Netflix por costar parecido: se pregunta, y la luz viene propuesta", () => {
    const p = calcularPropuestas(bd, "2026-10-30");
    const spotify = p.gastos.find((x) => x.periodico.nombre === "Spotify")!;
    const iberdrola = p.gastos.find((x) => x.periodico.nombre.startsWith("Iberdrola"))!;
    assert.deepEqual([spotify.accion, spotify.posibles], ["crear", [{ id: netflix, nombre: "Netflix", sugerido: false }]]);
    assert.deepEqual([iberdrola.accion, iberdrola.posibles], ["crear", [{ id: luz, nombre: "Luz y gas", sugerido: true }]]);
    // Eliges: Spotify es nuevo y lo de Iberdrola es tu «Luz y gas»
    aceptarPropuestas(bd, "2026-10-30", [{ id: spotify.id }, { id: iberdrola.id, unir: luz }]);
    assert.ok(leerRecurrentes(bd).some((r) => r.nombre === "Spotify"));
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM apuntes WHERE recurrente_id = ?", luz)?.n, 5);
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM apuntes WHERE recurrente_id = ?", netflix)?.n, 0);
    assert.equal(leerRecurrentes(bd, luz)[0]?.patron, "iberdrola clientes");
    assert.equal(leerRecurrentes(bd, luz)[0]?.clase, "estimacion", "cada factura es distinta: pasa a estimación para reconocerlas todas");
  });
});
