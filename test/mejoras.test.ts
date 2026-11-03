// Mejoras de noviembre de 2026: el ocio con tu ahorro real, préstamos con cuota final, traspasos a tu nombre,
// avisos de cosas raras, categorías por parecido, gastos compartidos, ingresos que varían, el IRPF y
// «Aplicar estos cambios de verdad» en la Calculadora.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { BaseDatos } from "../src/datos/db.ts";
import { cuadroAmortizacion, cuotaMensual, finCuotas, finPrestamo } from "../src/dominio/prestamo.ts";
import { importeEn } from "../src/dominio/recurrencia.ts";
import { evaluar } from "../src/reglas/escalera.ts";
import { estimarIrpf, type Tramo } from "../src/reglas/irpf.ts";
import { MERCADO_SEMILLA } from "../src/reglas/mercado.semilla.ts";
import { aplicarPrueba, cambiosAplicables } from "../src/servicios/aplicarPrueba.ts";
import { simular, sinCambios, type Prueba } from "../src/servicios/calculadora.ts";
import { aplicarCategorias, proponerCategorias } from "../src/servicios/categorias.ts";
import { proponerDevoluciones, separarDevoluciones, unirDevoluciones } from "../src/servicios/compartidos.ts";
import { guardarPerfil } from "../src/servicios/configuracion.ts";
import { guardarSaldo } from "../src/servicios/cuentas.ts";
import { crearRecurrente, deudas, leerRecurrentes, type DatosRecurrente } from "../src/servicios/finanzas.ts";
import { aceptarPropuestas, calcularPropuestas, ignorarPropuesta } from "../src/servicios/periodicos.ts";
import { cobrosAlCerrar, ingresoPrudente, revisarDatos } from "../src/servicios/revision.ts";
import { prepararBase } from "../src/servicios/semillas.ts";
import { construir, ocioGastadoEn } from "../src/servicios/situacion.ts";
import { esDelTitular } from "../src/servicios/titular.ts";
import { appDePrueba } from "./ayuda-app.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-mejoras-"));
const abiertas: BaseDatos[] = [];
after(() => {
  for (const bd of abiertas) bd.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});

function base(nombre: string): BaseDatos {
  const bd = new BaseDatos(path.join(carpeta, `${nombre}.db`));
  abiertas.push(bd);
  prepararBase(bd);
  return bd;
}
const HOY = "2026-11-03";
const fijo = { fin: null, esencial: true, clase: "fijo" as const, nota: null, prestamo: null, categoriaId: null };
const categoria = (bd: BaseDatos, nombre: string) => bd.uno<{ id: number }>("SELECT id FROM categorias WHERE nombre = ?", nombre)!.id;
const apunte = (bd: BaseDatos, fecha: string, importe: number, concepto: string, categoriaId: number | null = null) =>
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, categoria_id, origen) VALUES (?, ?, ?, ?, 'banco')", fecha, importe, concepto, categoriaId).id;

// La financiación de una moto: 36 cuotas de 85,72 € y una cuota final de 2.900 €
const moto: DatosRecurrente = {
  ...fijo,
  tipo: "gasto",
  nombre: "Moto",
  frecuencia: "mensual",
  inicio: "2026-10-05",
  importe: 0,
  prestamo: { capital: 520000, tin: 6.25, tae: 7.1, plazoMeses: 36, comisionAmortizacion: 0, vinculado: false, cuotaFinal: 290000 },
};

describe("el ocio con lo que de verdad apartas", () => {
  it("si tu ahorro automático aparta más de lo que pide la regla, eso sale del ocio", () => {
    const bd = base("ocio");
    crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2025-01-28", importe: 200000 });
    crearRecurrente(bd, { ...fijo, tipo: "gasto", nombre: "Alquiler", frecuencia: "mensual", inicio: "2025-01-01", importe: 80000 });
    const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nómina', 'corriente')").id;
    guardarSaldo(bd, cuenta, "2026-11-01", 3_000_000);
    const b = construir(bd, HOY);
    const p = simular(b, sinCambios()).resultado.presupuesto;
    assert.equal(p.objetivoAhorro, p.ahorroRegla, "sin ahorro automático, lo que pide la regla");
    const apartas = p.ahorroRegla + 20000;
    const con = simular(b, { ...sinCambios(), ahorroAutomatico: apartas }).resultado.presupuesto;
    assert.equal(con.ahorroRegla, p.ahorroRegla, "la regla pide lo mismo");
    assert.equal(con.objetivoAhorro, apartas, "pero apartas más");
    assert.equal(con.ocioPlan, p.ocioPlan - 20000, "y eso ya no está para ocio");
    const menos = simular(b, { ...sinCambios(), ahorroAutomatico: p.ahorroRegla - 10000 }).resultado.presupuesto;
    assert.equal(menos.objetivoAhorro, p.ahorroRegla, "si apartas menos, la regla sigue pidiendo lo suyo");
    assert.equal(evaluar({ ...b.situacion, ahorroAutomatico: 10_000_000 }, b.parametros).presupuesto.objetivoAhorro, p.sobrante, "nunca más de lo que sobra");
  });
});

describe("préstamos con cuota final", () => {
  it("sale la cuota del contrato (85,72 €) y el último pago es la cuota final", () => {
    assert.equal(cuotaMensual(520000, 6.25, 36, 290000), 8572);
    const p = { ...moto.prestamo!, primeraCuota: moto.inicio };
    const cuadro = cuadroAmortizacion(p);
    assert.equal(cuadro.length, 37);
    assert.equal(cuadro.at(-1)!.final, true);
    assert.equal(cuadro.at(-1)!.cuota, 290000, "la cuota final, la del contrato");
    assert.ok(Math.abs(cuadro.at(-2)!.cuota - 8572) <= 20, "los céntimos del redondeo van a la última cuota normal");
    assert.equal(cuadro.reduce((s, f) => s + f.cuota, 0), 35 * 8572 + cuadro.at(-2)!.cuota + 290000, "35 cuotas iguales, la última normal y la final");
    assert.equal(finCuotas(p), "2029-09-05", "la última cuota normal");
    assert.equal(finPrestamo(p), "2029-10-05", "la cuota final, un mes después");
  });

  it("cada mes cuenta la cuota, y la cuota final sigue siendo deuda hasta pagarla, con aviso", () => {
    const bd = base("cuota-final");
    const id = crearRecurrente(bd, moto);
    const [r] = leerRecurrentes(bd, id);
    assert.equal(r!.fin, "2029-09-05", "el gasto de cada mes acaba con la última cuota normal");
    assert.equal(importeEn(r!.versiones, HOY), 8572);
    const despues = deudas(leerRecurrentes(bd), "2029-09-20");
    assert.equal(despues.length, 1, "pagadas las cuotas, aún debes la final");
    assert.equal(despues[0]!.cuotaFinal?.fecha, "2029-10-05");
    assert.equal(deudas(leerRecurrentes(bd), "2029-10-06").length, 0, "pagada la final, ya no debes nada");
    const agosto = construir(bd, "2029-08-01");
    const avisos = evaluar(agosto.situacion, agosto.parametros).avisos.map((a) => a.texto);
    assert.ok(avisos.some((t) => /cuota final de «Moto»/.test(t) && /refinancias/.test(t)), avisos.join("\n"));
  });
});

describe("traspasos a tu nombre", () => {
  it("reconoce tu nombre en quien recibe o envía, no en un recibo que lo lleva dentro", () => {
    const yo = "Laura Gómez Ferrer";
    assert.ok(esDelTitular("hucha · Laura;Gomez Ferrer", yo));
    assert.ok(esDelTitular("TRANSFERENCIA A LAURA GOMEZ", yo), "en un extracto, una transferencia con tu nombre (basta nombre y primer apellido)");
    assert.ok(!esDelTitular("RECIBO TIT:LAURA GOMEZ FERRER REF 0042 · Motor Finance SA", yo), "un recibo de una financiera a tu nombre no es un traspaso");
    assert.ok(!esDelTitular("COMPRA TARJ. LAURA GOMEZ FERRER", yo), "en un extracto, sin palabra de transferencia no");
    assert.ok(!esDelTitular("hucha · Laura;Garcia", yo), "otra persona con tu nombre");
    assert.ok(!esDelTitular("hucha · Laura;Gomez Ferrer", null));
  });

  it("se proponen como traspaso: al aceptarlo deja de ser un gasto; al ignorarlo, vuelve a contar", () => {
    const bd = base("traspasos");
    guardarPerfil(bd, { titular: "Laura Gómez Ferrer" });
    const hucha = apunte(bd, "2026-10-29", -50000, "hucha · Laura;Gomez Ferrer");
    const regalo = apunte(bd, "2026-10-30", -3000, "Bizum enviado · Laura;Gomez Ferrer");
    apunte(bd, "2026-10-30", -8572, "RECIBO TIT:LAURA GOMEZ FERRER · Motor Finance SA");
    const p = calcularPropuestas(bd, HOY);
    assert.deepEqual(p.traspasos.map((t) => t.apunte.id).sort(), [hucha, regalo].sort());
    assert.equal(aceptarPropuestas(bd, HOY, [{ id: `t${hucha}` }]).traspasos, 1);
    assert.equal(bd.uno<{ traspaso: number }>("SELECT traspaso FROM apuntes WHERE id = ?", hucha)!.traspaso, 1);
    assert.ok(ignorarPropuesta(bd, HOY, `t${regalo}`));
    assert.equal(bd.uno<{ traspaso: number }>("SELECT traspaso FROM apuntes WHERE id = ?", regalo)!.traspaso, 0, "dijiste que no: no se vuelve a preguntar");
    assert.equal(calcularPropuestas(bd, HOY).traspasos.length, 0);
  });
});

describe("avisos de cosas raras", () => {
  it("dos gastos fijos iguales, y un gasto que empieza más tarde que sus cargos", () => {
    const bd = base("revisar");
    const seguros = categoria(bd, "Seguros");
    const seguro = crearRecurrente(bd, { ...fijo, categoriaId: seguros, tipo: "gasto", nombre: "Seguro moto", frecuencia: "mensual", inicio: "2026-01-01", importe: 2490 });
    const mapfre = crearRecurrente(bd, { ...fijo, categoriaId: seguros, tipo: "gasto", nombre: "Mapfre", frecuencia: "mensual", inicio: "2026-03-01", importe: 2490 });
    crearRecurrente(bd, { ...fijo, categoriaId: categoria(bd, "Suministros"), tipo: "gasto", nombre: "Móvil", frecuencia: "mensual", inicio: "2026-03-01", importe: 2490 });
    const gym = crearRecurrente(bd, { ...fijo, esencial: false, tipo: "gasto", nombre: "Gimnasio", frecuencia: "mensual", inicio: "2026-09-01", importe: 3500 });
    for (const fecha of ["2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03"]) {
      const id = apunte(bd, fecha, -3500, "GIMNASIO FIT");
      bd.ejecutar("UPDATE apuntes SET recurrente_id = ? WHERE id = ?", gym, id);
    }
    const avisos = revisarDatos(bd, leerRecurrentes(bd), HOY);
    const duplicados = avisos.filter((a) => /cuestan lo mismo/.test(a.texto));
    assert.equal(duplicados.length, 1, "el móvil cuesta lo mismo, pero no es un seguro");
    assert.ok([`/gastos/${mapfre}`, `/gastos/${seguro}`].includes(duplicados[0]!.enlace?.ruta ?? ""), "un enlace para revisar uno de los dos");
    assert.ok(avisos.some((a) => /«Gimnasio» tiene movimientos en el banco desde el 03\/06\/2026/.test(a.texto)));
  });

  it("al cerrar el mes, la nómina que llega el último día (aunque no siempre el mismo)", () => {
    const bd = base("cierre");
    const nomina = crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2026-01-30", importe: 118946 });
    assert.deepEqual(
      cobrosAlCerrar(bd, leerRecurrentes(bd), "2026-11-30").map((x) => x.fecha),
      ["2026-11-30"],
      "sin importar aún, el día previsto",
    );
    const id = apunte(bd, "2026-10-31", 118946, "NOMINA EMPRESA");
    bd.ejecutar("UPDATE apuntes SET recurrente_id = ? WHERE id = ?", nomina, id);
    assert.deepEqual(
      cobrosAlCerrar(bd, leerRecurrentes(bd), "2026-10-31").map((x) => x.fecha),
      ["2026-10-31"],
      "importado, el día en que llegó de verdad",
    );
  });
});

describe("ingresos que varían", () => {
  it("lo prudente es un mes flojo: el segundo más bajo de los 6 últimos", () => {
    const bd = base("variable");
    const id = crearRecurrente(bd, { ...fijo, clase: "estimacion", tipo: "ingreso", nombre: "Facturas", frecuencia: "mensual", inicio: "2026-01-01", importe: 150000 });
    const meses = { "2026-05": 180000, "2026-06": 90000, "2026-07": 140000, "2026-08": 110000, "2026-09": 200000, "2026-10": 160000, "2026-11": 10000 };
    for (const [mes, importe] of Object.entries(meses)) bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto, recurrente_id) VALUES (?, ?, 'FACTURA', ?)", `${mes}-10`, importe, id);
    const [r] = leerRecurrentes(bd, id);
    const prudente = ingresoPrudente(bd, r!, HOY);
    assert.equal(prudente?.importe, 110000, "el mes en curso no cuenta; de mayo a octubre, el segundo más bajo");
    const avisos = revisarDatos(bd, leerRecurrentes(bd), HOY).map((a) => a.texto);
    assert.ok(avisos.some((t) => /lo prudente es 1\.100\s€/.test(t)), avisos.join("\n"));
    assert.ok(avisos.some((t) => /inestables/.test(t)), "y que lo marques en tu perfil");
  });
});

describe("categorías por parecido", () => {
  it("propone la categoría que ya diste a los mismos movimientos y crea su regla", () => {
    const bd = base("categorias");
    const ocio = categoria(bd, "Ocio");
    for (const fecha of ["2026-07-02", "2026-08-02", "2026-09-02"]) apunte(bd, fecha, -1500, "Bizum enviado · Jordi;Puig Serra", ocio);
    const sin = apunte(bd, "2026-10-02", -2200, "Bizum enviado · Jordi;Puig Serra");
    const [p] = proponerCategorias(bd, HOY);
    assert.ok(p, "una propuesta");
    assert.deepEqual(p.apunteIds, [sin]);
    assert.equal(p.categoriaId, ocio);
    assert.equal(p.nombre, "Jordi Puig");
    assert.ok(p.regla && "bizum enviado · jordi;puig serra".includes(p.regla), p.regla ?? "sin regla");
    assert.equal(aplicarCategorias(bd, HOY, [{ clave: p.clave, categoriaId: ocio, regla: true }]), 1);
    assert.equal(bd.uno<{ categoria_id: number }>("SELECT categoria_id FROM apuntes WHERE id = ?", sin)!.categoria_id, ocio);
    assert.ok(bd.uno("SELECT 1 FROM reglas_categoria WHERE patron = ?", p.regla));
    assert.equal(proponerCategorias(bd, HOY).length, 0);
  });
});

describe("gastos compartidos", () => {
  it("la cena que pagaste tú y los Bizums de tus amigos: el ocio cuenta solo tu parte", () => {
    const bd = base("compartidos");
    const restaurantes = categoria(bd, "Restaurantes");
    const cena = apunte(bd, "2026-10-17", -12000, "BRASERIA LA PLACA", restaurantes);
    const bizums = [
      apunte(bd, "2026-10-17", 3000, "Bizum recibido · Marta;Ruiz Vidal"),
      apunte(bd, "2026-10-18", 3000, "Bizum recibido · Marc;Puig"),
      apunte(bd, "2026-10-19", 3000, "Bizum recibido · Laia;Roca"),
    ];
    apunte(bd, "2026-10-25", 3000, "Bizum recibido · Jordi;Vila");
    assert.equal(ocioGastadoEn(bd, "2026-10-01"), 12000);
    const [p] = proponerDevoluciones(bd, HOY);
    assert.equal(p?.gasto.id, cena);
    assert.deepEqual(p.entradas.map((e) => e.id), bizums, "el Bizum de una semana después no");
    assert.equal(p.motivo, "varios");
    unirDevoluciones(bd, cena, p.entradas.map((e) => e.id));
    assert.equal(ocioGastadoEn(bd, "2026-10-01"), 3000, "pagaste 120 €, te devolvieron 90 €");
    assert.equal(proponerDevoluciones(bd, HOY).length, 0, "lo que ya decidiste no se vuelve a proponer");
    separarDevoluciones(bd, [bizums[2]!]);
    assert.equal(ocioGastadoEn(bd, "2026-10-01"), 6000, "separar no borra nada: ese Bizum vuelve a ser un ingreso");
    assert.equal(proponerDevoluciones(bd, HOY).length, 0, "y no se vuelve a proponer");
  });

  it("la misma persona te devuelve lo que le pagaste", () => {
    const bd = base("misma-persona");
    const enviado = apunte(bd, "2026-10-05", -4000, "Bizum enviado · Clara;Soler");
    const vuelta = apunte(bd, "2026-10-12", 2000, "Bizum recibido · Clara;Soler");
    const [p] = proponerDevoluciones(bd, HOY);
    assert.equal(p?.gasto.id, enviado);
    assert.deepEqual(p.entradas.map((e) => e.id), [vuelta]);
    assert.equal(p.motivo, "misma-persona");
  });
});

describe("el IRPF", () => {
  const tramos = (clave: string) => MERCADO_SEMILLA.find((d) => d.clave === clave)!.valor as Tramo[];
  const estatal = tramos("irpf_general_estatal");
  const cataluna = tramos("irpf_general_cataluna");

  it("un sueldo bajo no paga IRPF; 30.000 € en Cataluña pagan unos 4.959 € con un marginal del 31 %", () => {
    const bajo = estimarIrpf(15300, estatal, cataluna);
    assert.equal(Math.round(bajo.cuota), 0);
    assert.equal(bajo.marginal, 0, "aportar a un plan de pensiones no te ahorra nada");
    const medio = estimarIrpf(30000, estatal, cataluna);
    assert.equal(Math.round(medio.cuota), 4959);
    assert.equal(Math.round(medio.marginal), 31);
    assert.equal(Math.round(medio.cotizaciones), 1950, "6,5 % de cotización");
  });
});

describe("aplicar la prueba de la Calculadora", () => {
  const bd = base("aplicar");
  const nomina = crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2025-01-28", importe: 200000 });
  const netflix = crearRecurrente(bd, { ...fijo, esencial: false, tipo: "gasto", nombre: "Netflix", frecuencia: "mensual", inicio: "2025-01-01", importe: 1500 });
  const coche = crearRecurrente(bd, {
    ...fijo,
    tipo: "gasto",
    nombre: "Coche",
    frecuencia: "mensual",
    inicio: "2026-01-10",
    importe: 0,
    prestamo: { capital: 1_000_000, tin: 5, tae: null, plazoMeses: 48, comisionAmortizacion: 0, vinculado: false },
  });
  const viaje = bd.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado) VALUES ('Viaje', 300000, '2027-10-01', 0)").id;
  const cuenta = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Nómina', 'corriente')").id;
  guardarSaldo(bd, cuenta, "2026-11-01", 500000);

  const prueba: Prueba = {
    ...sinCambios(),
    importes: new Map([[nomina, 210000]]),
    quitados: new Set([netflix]),
    nuevos: [{ fila: 1, tipo: "gasto", esencial: false, nombre: "Gimnasio", importe: 4000, frecuencia: "mensual" }],
    metas: new Map([[viaje, { objetivo: 400000 }]]),
    metaNueva: { nombre: "Sofá", objetivo: 90000, ahorrado: 0, fecha: "2027-06-01" },
    parametros: { ocioMinimoPct: 15 },
    adelantos: new Map([[coche, { importe: 200000, modo: "plazo" as const }]]),
    liquidez: 900000,
  };

  it("lista cada cambio; un adelanto viene sin marcar y el dinero de tus cuentas no se aplica", () => {
    const lista = cambiosAplicables(bd, construir(bd, HOY), prueba);
    const de = (clave: string) => lista.find((x) => x.clave === clave);
    assert.equal(de(`importe:${nomina}`)?.marcado, true);
    assert.equal(de(`adelanto:${coche}`)?.marcado, false, "solo si ya lo has pagado");
    assert.equal(de("liquidez")?.aplicable, false);
    assert.equal(de("liquidez")?.enlace?.ruta, "/cuentas");
  });

  it("aplica solo lo marcado, desde hoy, y los meses anteriores no cambian", () => {
    const b = construir(bd, HOY);
    const elegidos = new Set(cambiosAplicables(bd, b, prueba).filter((x) => x.marcado).map((x) => x.clave));
    assert.equal(aplicarPrueba(bd, b, prueba, new Set([...elegidos, "liquidez"]), HOY), 6, "la liquidez no cuenta aunque llegue marcada");
    const r = new Map(leerRecurrentes(bd).map((x) => [x.id, x]));
    assert.equal(importeEn(r.get(nomina)!.versiones, HOY), 210000);
    assert.equal(importeEn(r.get(nomina)!.versiones, "2026-10-28"), 200000, "octubre conserva su importe");
    assert.equal(r.get(netflix)!.fin, HOY);
    assert.ok([...r.values()].some((x) => x.nombre === "Gimnasio" && x.inicio === HOY && importeEn(x.versiones, HOY) === 4000));
    assert.equal(bd.uno<{ objetivo: number }>("SELECT objetivo FROM metas WHERE id = ?", viaje)!.objetivo, 400000);
    assert.ok(bd.uno("SELECT 1 FROM metas WHERE nombre = 'Sofá' AND objetivo = 90000"));
    assert.equal(construir(bd, HOY).parametros.ocioMinimoPct, 15);
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM amortizaciones")!.n, 0, "el adelanto no se apunta si no lo marcas");
  });
});

describe("pantallas nuevas", () => {
  const { bd, pedir, carpeta: carpetaApp, estado } = appDePrueba(4719, HOY);
  after(() => {
    estado.sync?.cerrar();
    rmSync(carpetaApp, { recursive: true, force: true });
  });
  const netflix = crearRecurrente(bd, { ...fijo, esencial: false, tipo: "gasto", nombre: "Netflix", frecuencia: "mensual", inicio: "2025-01-01", importe: 1500 });
  crearRecurrente(bd, { ...fijo, tipo: "ingreso", nombre: "Nómina", frecuencia: "mensual", inicio: "2025-01-28", importe: 200000 });

  it("de la Calculadora a «Aplicar estos cambios de verdad», y se guarda solo al confirmar", async () => {
    const resultado = await (await pedir(`/calculadora/resultado?importe_${netflix}=17,99`)).text();
    const enlace = /href="(\/calculadora\/aplicar\?[^"]+)"/.exec(resultado)?.[1]?.replaceAll("&amp;", "&");
    assert.ok(enlace, "el enlace sale con los cambios");
    const pagina = await (await pedir(enlace)).text();
    assert.match(pagina, /«Netflix»: de 15,00\s€ a 17,99\s€/);
    assert.match(pagina, new RegExp(`name="importe_${netflix}" value="17,99"`));
    assert.equal(importeEn(leerRecurrentes(bd, netflix)[0]!.versiones, HOY), 1500, "ver la página no guarda nada");
    const sinMarcar = await pedir("/calculadora/aplicar", { [`importe_${netflix}`]: "17,99" });
    assert.match(sinMarcar.headers.get("location") ?? "", /error=/);
    const respuesta = await pedir("/calculadora/aplicar", { [`importe_${netflix}`]: "17,99", aplicar: `importe:${netflix}` });
    assert.equal(respuesta.status, 303);
    assert.match(new URL(respuesta.headers.get("location") ?? "", "http://x").searchParams.get("ok") ?? "", /1 cambio aplicado/);
    assert.equal(importeEn(leerRecurrentes(bd, netflix)[0]!.versiones, HOY), 1799);
  });

  it("un préstamo con cuota final crea su meta, sin duplicar la que ya tuvieras para ella", async () => {
    const moto = { tipo: "gasto", nombre: "Moto", prestamo: "1", capital: "5200", tin: "6,25", plazo: "36", cuota_final: "2900", inicio: "2025-10-30", meta_cuota_final: "1" };
    bd.ejecutar("INSERT INTO metas (nombre, objetivo, fecha, ahorrado) VALUES ('Cuota final de la moto', 290000, '2028-10-30', 0)");
    assert.equal((await pedir("/gastos", moto)).status, 303);
    const metas = bd.todos<{ nombre: string; objetivo: number; fecha: string }>("SELECT nombre, objetivo, fecha FROM metas WHERE nombre LIKE 'Cuota final%'");
    assert.deepEqual(metas.map((m) => ({ ...m })), [{ nombre: "Cuota final de la moto", objetivo: 290000, fecha: "2028-10-30" }], "usa la que ya tenías");
    assert.equal((await pedir("/gastos", { ...moto, nombre: "Coche", capital: "15000", cuota_final: "5000", inicio: "2026-01-10" })).status, 303);
    assert.ok(bd.uno("SELECT 1 FROM metas WHERE nombre = 'Cuota final de «Coche»' AND objetivo = 500000 AND fecha = '2029-01-10'"), "y crea una para otra");
  });

  it("el IRPF en Ajustes", async () => {
    const pagina = await (await pedir("/ajustes?bruto=30000#irpf")).text();
    assert.match(pagina, /id="irpf"/);
    assert.match(pagina, /Usar 3\d %/);
  });
});
