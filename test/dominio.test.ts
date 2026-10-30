import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leerImporte, leerNumero } from "../src/dominio/dinero.ts";
import { diferenciaMeses, sumarDias, sumarMeses } from "../src/dominio/fechas.ts";
import { cuadroAmortizacion, cuotaMensual, finPrestamo, pendienteEn, type Prestamo } from "../src/dominio/prestamo.ts";
import {
  cuotasRestantes,
  estadoEn,
  finPorCuotas,
  importeEn,
  mensualEn,
  ocurrencias,
  provisionAcumulada,
  type Recurrente,
} from "../src/dominio/recurrencia.ts";

describe("importes y números", () => {
  it("lee formatos españoles e ingleses", () => {
    assert.equal(leerImporte("1.234,56"), 123456);
    assert.equal(leerImporte("1234,56 €"), 123456);
    assert.equal(leerImporte("1,234.56"), 123456);
    assert.equal(leerImporte("250"), 25000);
    assert.equal(leerImporte("1.234"), 123400);
    assert.equal(leerImporte("-45,9"), -4590);
    assert.equal(leerNumero("3,04 %"), 3.04);
    assert.equal(leerNumero("12.5"), 12.5);
    assert.equal(leerImporte("abc"), null);
    assert.equal(leerImporte(""), null);
  });

  it("se queda solo con el número aunque lleve la moneda o el signo en otro sitio", () => {
    assert.equal(leerImporte("-200 EUR"), -20000);
    assert.equal(leerImporte("EUR -1.234,56"), -123456);
    assert.equal(leerImporte("- 200 €"), -20000);
    assert.equal(leerImporte("-€200"), -20000);
    assert.equal(leerImporte("200,00-"), -20000, "menos detrás, como en algunos bancos");
    assert.equal(leerImporte("(1.234,56)"), -123456, "paréntesis de contabilidad");
    assert.equal(leerImporte("\u221245,90 €"), -4590, "signo menos tipográfico");
    assert.equal(leerImporte("USD 1,234.56"), 123456);
    assert.equal(leerImporte("+1.500 EUR"), 150000);
    assert.equal(leerImporte("1\u00a0234,56 €"), 123456, "espacio de miles");
    assert.equal(leerImporte("2 x 3,50"), null, "con dos números no adivina");
    assert.equal(leerImporte("03/10/2026"), null);
    assert.equal(leerImporte("EUR"), null);
  });
});

describe("fechas", () => {
  it("suma meses sin pasarse del final de mes", () => {
    assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28");
    assert.equal(sumarMeses("2028-01-31", 1), "2028-02-29");
    assert.equal(sumarMeses("2026-11-15", 3), "2027-02-15");
    assert.equal(diferenciaMeses("2026-10-30", "2027-01-01"), 3);
    assert.equal(sumarDias("2026-12-30", 3), "2027-01-02");
  });
});

const coche: Recurrente = { id: 1, tipo: "gasto", nombre: "Coche", frecuencia: "mensual", inicio: "2024-03-05", fin: finPorCuotas("2024-03-05", "mensual", 60), esencial: true };
const seguro: Recurrente = { id: 2, tipo: "gasto", nombre: "Seguro", frecuencia: "anual", inicio: "2027-01-15", fin: null, esencial: true };

describe("recurrentes", () => {
  it("calcula el fin por número de cuotas y pasa a finalizado solo", () => {
    assert.equal(coche.fin, "2029-02-05");
    assert.equal(estadoEn(coche, "2026-10-30"), "activo");
    assert.equal(estadoEn(coche, "2029-02-05"), "activo");
    assert.equal(estadoEn(coche, "2029-02-06"), "finalizado");
    assert.equal(cuotasRestantes(coche, "2026-10-30"), 28);
  });

  it("lista los cargos de un periodo", () => {
    assert.deepEqual(ocurrencias(coche, "2029-01-01", "2029-12-31"), ["2029-01-05", "2029-02-05"]);
    assert.deepEqual(ocurrencias(seguro, "2026-01-01", "2028-12-31"), ["2027-01-15", "2028-01-15"]);
  });

  it("un cambio de importe no cambia los meses anteriores", () => {
    const versiones = [
      { validoDesde: "2024-03-05", importe: 25000 },
      { validoDesde: "2027-01-01", importe: 27000 },
    ];
    assert.equal(importeEn(versiones, "2026-12-31"), 25000);
    assert.equal(importeEn(versiones, "2027-01-01"), 27000);
    assert.equal(mensualEn(coche, versiones, "2026-12"), 25000);
    assert.equal(mensualEn(coche, versiones, "2027-01"), 27000);
    assert.equal(mensualEn(coche, versiones, "2029-03"), 0, "después del último cargo ya no cuenta");
  });

  it("reparte los gastos anuales entre los meses previos y calcula lo que ya debería estar apartado", () => {
    const versiones = [{ validoDesde: "2026-01-01", importe: 60000 }];
    assert.equal(mensualEn(seguro, versiones, "2026-01"), 0, "empieza a provisionarse 11 meses antes del primer cargo");
    assert.equal(mensualEn(seguro, versiones, "2026-02"), 5000);
    assert.equal(provisionAcumulada(seguro, versiones, "2026-10-30"), 45000, "faltan 3 meses: 9/12 de 600 €");
    assert.equal(provisionAcumulada(seguro, versiones, "2027-01-10"), 60000, "se cobra este mes: entero");
    assert.equal(provisionAcumulada(seguro, versiones, "2027-01-20"), 0, "recién cobrado: vuelve a cero");
    assert.equal(provisionAcumulada(seguro, versiones, "2027-02-01"), 5000, "un mes después: 1/12");
  });
});

describe("préstamos (sistema francés)", () => {
  const prestamo: Prestamo = { capital: 1_000_000, tin: 5, tae: null, plazoMeses: 48, primeraCuota: "2026-01-10", comisionAmortizacion: 0, vinculado: false };

  it("la cuota coincide con la de un simulador bancario", () => {
    assert.equal(cuotaMensual(1_000_000, 5, 48), 23029);
    assert.equal(cuotaMensual(1_200_000, 0, 48), 25000);
  });

  it("el cuadro devuelve todo el capital y termina en la fecha correcta", () => {
    const cuadro = cuadroAmortizacion(prestamo);
    assert.equal(cuadro.length, 48);
    assert.equal(cuadro.reduce((suma, fila) => suma + fila.amortizacion, 0), 1_000_000);
    assert.equal(cuadro.at(-1)?.pendiente, 0);
    assert.equal(finPrestamo(prestamo), "2029-12-10");
    assert.equal(cuadro[0]?.intereses, 4167);
  });

  it("calcula lo pendiente en una fecha", () => {
    assert.equal(pendienteEn(prestamo, "2025-12-31"), 1_000_000);
    assert.equal(pendienteEn(prestamo, "2026-01-10"), 1_000_000 - (23029 - 4167));
    assert.equal(pendienteEn(prestamo, "2030-01-01"), 0);
  });
});
