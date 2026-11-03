// Calderilla con datos de ejemplo en una carpeta temporal, para revisarla con Playwright sin tocar tus datos:
// lo justo para que cada pantalla tenga de todo, con textos largos y cortos. Lo usan revisar-pantallas y
// probar-recorridos.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { sumarDias } from "../src/dominio/fechas.ts";

export const HOY = "2026-10-30";

export async function arrancarEjemplo(puerto: number) {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-ejemplo-"));
  // Los ajustes de este ordenador (bancos, claves…) también en la carpeta temporal: antes de cargar la app
  process.env.CALDERILLA_CONFIG_DIR = carpeta;
  const { Sincronizador } = await import("../src/datos/sync.ts");
  const { crearApp } = await import("../src/servidor/app.ts");
  const { prepararBase } = await import("../src/servicios/semillas.ts");
  const { crearRecurrente } = await import("../src/servicios/finanzas.ts");
  const { guardarSaldo } = await import("../src/servicios/cuentas.ts");
  const { guardarPerfil } = await import("../src/servicios/configuracion.ts");

  const estado = {
    ajustes: { carpetaDatos: path.join(carpeta, "datos"), equipoId: "aaaaaaaa", equipoNombre: "Revisión", puerto, abrirNavegador: false, coingeckoClave: null },
    sync: null as InstanceType<typeof Sincronizador> | null,
    token: "revision",
    hoy: () => HOY,
    errorFatal: null,
    usarCarpeta: () => {},
    guardarAjustes: () => {},
  };
  estado.sync = new Sincronizador({ carpetaDatos: estado.ajustes.carpetaDatos, rutaTrabajo: path.join(carpeta, "trabajo.db"), equipoId: "aaaaaaaa", equipoNombre: "Revisión", alAbrir: prepararBase });
  const bd = estado.sync.bd;

  const cat = (nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
  const fijo = { fin: null, esencial: true, clase: "fijo" as const, nota: null, prestamo: null };
  guardarPerfil(bd, { estabilidad: "normal", riesgo: "moderado", tipoMarginal: 30, tipoRescate: 21, aportacionEmpresa: 0, titular: "Laura Gómez Ferrer" });
  // 14 pagas: la nómina con las extras de junio y diciembre, y unas clases que se cobran dos veces al mes
  const nomina = crearRecurrente(bd, {
    ...fijo,
    tipo: "ingreso",
    nombre: "Nómina",
    categoriaId: cat("Nómina"),
    frecuencia: "mensual",
    inicio: "2024-01-28",
    importe: 215000,
    pagasExtra: [{ nombre: null, meses: [6, 12], importe: null }],
  });
  const clases = crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Clases de inglés", categoriaId: null, frecuencia: "quincenal", inicio: "2026-09-01", importe: 12000 });
  crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Alquiler", categoriaId: cat("Vivienda"), frecuencia: "mensual", inicio: "2024-01-01", importe: 75000 });
  crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Luz y gas", categoriaId: cat("Suministros"), frecuencia: "mensual", inicio: "2024-01-10", importe: 6500 });
  crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Comida", categoriaId: cat("Alimentación"), frecuencia: "mensual", inicio: "2024-01-01", importe: 32000, clase: "estimacion" });
  crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Seguro de hogar multirriesgo con cobertura ampliada", categoriaId: cat("Seguros"), frecuencia: "anual", inicio: "2027-02-01", importe: 41235 });
  const netflix = crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Netflix", categoriaId: cat("Suscripciones"), frecuencia: "mensual", inicio: "2024-01-01", importe: 1399, esencial: false });
  crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Gimnasio", categoriaId: cat("Ocio"), frecuencia: "mensual", inicio: "2025-01-10", fin: "2026-09-10", importe: 3900, esencial: false });
  const coche = crearRecurrente(bd, {
    ...fijo,
    tipo: "gasto",
    nombre: "Coche",
    categoriaId: cat("Transporte"),
    frecuencia: "mensual",
    inicio: "2024-03-05",
    importe: 0,
    prestamo: { capital: 1_500_000, tin: 5.5, tae: null, plazoMeses: 60, comisionAmortizacion: 0.5, vinculado: true },
  });
  // Una moto financiada con cuota final: la última cuota normal en noviembre y el pago grande en diciembre
  const moto = crearRecurrente(bd, {
    ...fijo,
    tipo: "gasto",
    nombre: "Moto",
    categoriaId: cat("Transporte"),
    frecuencia: "mensual",
    inicio: "2023-12-20",
    importe: 0,
    prestamo: { capital: 600_000, tin: 5.85, tae: 6.71, plazoMeses: 36, comisionAmortizacion: 0, vinculado: false, cuotaFinal: 300_000 },
  });
  // Un ingreso que varía cada mes (traducciones sueltas): «lo prudente» es un mes flojo
  const traducciones = crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Traducciones", categoriaId: null, frecuencia: "mensual", inicio: "2026-04-01", importe: 45000, clase: "estimacion" });
  const cuenta = (nombre: string, tipo: string, entidad: string | null, saldo: number, tae: number | null = null) => {
    const id = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad, tae) VALUES (?, ?, ?, ?)", nombre, tipo, entidad, tae).id;
    guardarSaldo(bd, id, "2026-10-01", saldo);
    return id;
  };
  const cuentaNomina = cuenta("Nómina", "corriente", "BBVA", 234000);
  const ahorro = cuenta("Ahorro", "remunerada", "Trade Republic", 620000, 2.25);
  const viaje = cuenta("Cuenta remunerada para el viaje y el fondo de emergencia", "remunerada", "Openbank", 300000, 3.25);
  cuenta("Plan de pensiones", "plan_pensiones", "Indexa Capital", 450000);
  const gastos: [string, number, string, number | null, string | null][] = [
    ["2026-10-02", -5430, "COMPRA MERCADONA VALENCIA AV DEL PUERTO", cuentaNomina, "Alimentación"],
    ["2026-10-05", -2800, "GLOVO", cuentaNomina, "Restaurantes"],
    ["2026-10-09", -1500, "CINESA DIAGONAL", cuentaNomina, "Ocio"],
    ["2026-10-12", -8999, "AMAZON MARKETPLACE EU SARL PAGO CON TARJETA 4589", ahorro, "Compras"],
    ["2026-10-15", -4200, "REPSOL ESTACION DE SERVICIO", cuentaNomina, "Transporte"],
    ["2026-10-18", -350, "BIZUM A JUAN", null, null],
    ["2026-10-28", 215000, "NOMINA OCTUBRE EMPRESA SL", cuentaNomina, "Nómina"],
    ["2026-09-03", -6120, "MERCADONA", cuentaNomina, "Alimentación"],
    ["2026-09-14", -4500, "RESTAURANTE CASA PEPE", cuentaNomina, "Restaurantes"],
    ["2026-09-20", -3000, "TICKETMASTER ENTRADAS CONCIERTO", viaje, "Ocio"],
    ["2026-08-10", -5800, "LIDL", cuentaNomina, "Alimentación"],
    ["2026-08-22", -12000, "RYANAIR", cuentaNomina, "Viajes"],
  ];
  for (const [fecha, importe, concepto, cuentaId, categoria] of gastos) {
    bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, cuenta_id, categoria_id) VALUES (?, ?, ?, ?, ?)", fecha, importe, concepto, cuentaId, categoria ? cat(categoria) : null);
  }
  // Extractos importados de los dos bancos con cosas que se repiten, para «Encontrado en tus movimientos»
  const importado = (fecha: string, importe: number, concepto: string, cuentaId: number, categoria: string | null) =>
    bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, cuenta_id, categoria_id, origen) VALUES (?, ?, ?, ?, ?, 'csv')", fecha, importe, concepto, cuentaId, categoria ? cat(categoria) : null);
  for (const [i, mes] of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].entries()) {
    importado(`${mes}-07`, -1099, "COMPRA TARJ 4589 SPOTIFY P3F2A1", cuentaNomina, "Suscripciones");
    importado(`${mes}-01`, -30000, "TRANSFERENCIA A TRADE REPUBLIC", cuentaNomina, null);
    importado(`${mes}-02`, 30000, "Ingreso", ahorro, null);
    importado(`${mes}-14`, -(4200 + i * 300), "RECIBO IBERDROLA CLIENTES SAU FACTURA DEL PERIODO", cuentaNomina, "Suministros");
    for (const dia of ["06", "13", "20", "27"]) importado(`${mes}-${dia}`, -(3500 + ((Number(dia) + i * 7) % 5) * 900), "COMPRA TARJ 4589 CONSUM COOP VALENCIA", cuentaNomina, "Alimentación");
  }
  // Un segundo sueldo con la paga extra de junio sumada: «Buscar en mis movimientos» lo propone con sus pagas
  for (const mes of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) {
    importado(`${mes}-29`, mes === "2026-06" ? 220000 : 110000, "TRANSFERENCIA RECIBIDA RESTAURANTE MARE SL", cuentaNomina, null);
  }
  for (const [mes, importe] of Object.entries({ "2026-04": 40000, "2026-05": 25000, "2026-06": 60000, "2026-07": 30000, "2026-08": 45000, "2026-09": 20000 })) {
    const id = importado(`${mes}-15`, importe, "TRANSFERENCIA RECIBIDA TRADUCCIONES", cuentaNomina, null).id;
    bd.ejecutar("UPDATE apuntes SET recurrente_id = ? WHERE id = ?", traducciones, id);
  }
  // Un envío a una cuenta tuya que no importas (lleva tu nombre): «Buscar en mis movimientos» pregunta si es un traspaso
  importado("2026-10-21", -25000, "Envío a mi cuenta · Laura;Gomez Ferrer", cuentaNomina, null);
  // Una cena que pagaste tú y tres Bizums de tus amigos: Movimientos propone juntarlos
  importado("2026-10-24", -14000, "RESTAURANTE LA PEPICA", cuentaNomina, "Restaurantes");
  importado("2026-10-24", 3500, "Bizum recibido · Marta;Ruiz", cuentaNomina, null);
  importado("2026-10-25", 3500, "Bizum recibido · Pablo;Sanz Torres", cuentaNomina, null);
  importado("2026-10-26", 3500, "Bizum recibido · Nuria;Gil", cuentaNomina, null);
  // Compras en la misma tienda, dos con categoría y una sin: Movimientos propone la misma
  importado("2026-07-19", -2599, "COMPRA TARJ 4589 FNAC SAN AGUSTIN", cuentaNomina, "Compras");
  importado("2026-09-02", -4999, "COMPRA TARJ 4589 FNAC SAN AGUSTIN", cuentaNomina, "Compras");
  importado("2026-10-22", -1999, "COMPRA TARJ 4589 FNAC SAN AGUSTIN", cuentaNomina, null);
  // Un año antes, lo justo para comparar octubre con el del año pasado en «Tu año en cifras»
  importado("2025-10-05", -8500, "CARREFOUR VALENCIA", cuentaNomina, "Alimentación");
  importado("2025-10-12", -1800, "CINE LYS", cuentaNomina, "Ocio");
  importado("2025-10-20", -4500, "RESTAURANTE EL CABANYAL", cuentaNomina, "Restaurantes");
  importado("2025-10-28", 190000, "FINIQUITO TALLERES ROIG SL", cuentaNomina, "Nómina");
  // Una compra grande en junio sube la media de «Compras», y en octubre vas bastante por encima de ella
  importado("2026-06-11", -6000, "DECATHLON VALENCIA", cuentaNomina, "Compras");
  // Un trabajo de fin de semana que paga cada 2 semanas: lo encuentra «Buscar en mis movimientos»
  for (let fecha = "2026-06-05"; fecha <= "2026-10-28"; fecha = sumarDias(fecha, 14)) importado(fecha, 18000, "TRANSFERENCIA RECIBIDA EVENTOS LEVANTE SL", cuentaNomina, null);
  const fondo = bd.ejecutar("INSERT INTO activos (nombre, isin, tipo, renta) VALUES ('Fondo indexado mundial', 'IE00B03HCZ61', 'fondo', 'variable')").id;
  bd.ejecutar("INSERT INTO movimientos_cartera (activo_id, fecha, tipo, cantidad, importe) VALUES (?, '2026-01-15', 'compra', 50, 150000)", fondo);
  bd.ejecutar("INSERT INTO precios (activo_id, fecha, precio, fuente) VALUES (?, '2026-10-29', 34.5, 'manual')", fondo);
  const btc = bd.ejecutar("INSERT INTO activos (nombre, tipo, especulativo) VALUES ('Bitcoin', 'cripto', 1)").id;
  bd.ejecutar("INSERT INTO movimientos_cartera (activo_id, fecha, tipo, cantidad, importe) VALUES (?, '2026-02-01', 'compra', 0.01, 80000)", btc);
  bd.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado, cuenta_id) VALUES ('Viaje a Japón', 400000, '2028-06-01', 0, ?)", viaje);
  bd.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado) VALUES ('Entrada del piso en Valencia (20 % más gastos de notaría)', 4500000, '2030-06-01', 120000)");
  bd.ejecutar("INSERT INTO aportaciones (nombre, cuenta_id, importe, dia, inicio) VALUES ('Traspaso a Trade Republic', ?, 30000, 1, '2026-06-01')", ahorro);
  bd.ejecutar("INSERT INTO limites_categoria (categoria_id, limite) VALUES (?, 30000), (?, 6000)", cat("Alimentación"), cat("Restaurantes"));

  const servidor = serve({ fetch: crearApp(estado).fetch, hostname: "127.0.0.1", port: puerto });
  return {
    base: `http://127.0.0.1:${puerto}`,
    estado,
    bd,
    ids: { coche, moto, fondo, nomina, clases, netflix, traducciones },
    cerrar() {
      servidor.close();
      estado.sync?.cerrar();
      rmSync(carpeta, { recursive: true, force: true });
    },
  };
}
