// Los importes se guardan en céntimos (enteros) para no arrastrar errores de coma flotante.
export type Centimos = number;

const conDecimales = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const sinDecimales = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

export function euros(c: Centimos): string {
  return conDecimales.format(c / 100);
}

export function eurosRedondos(c: Centimos): string {
  return sinDecimales.format(Math.round(c / 100));
}

/** "3,04 %" */
export function porcentaje(valor: number, decimales = 2): string {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: decimales }).format(valor)} %`;
}

export function formatoNumero(valor: number): string {
  return numero.format(valor);
}

/**
 * Lee un número escrito a la española o a la inglesa: "1.234,56", "1234,56", "1,234.56", "12.5", "250".
 * - Se queda solo con el número: la moneda y otros textos alrededor se ignoran ("-200 EUR", "USD 1,234.56",
 *   "3,04 %"). Si hay más de un número ("2 x 3,50") no se adivina cuál es.
 * - El signo puede ir delante (también separado: "- 200 €", "EUR -200"), detrás ("200,00-") o entre
 *   paréntesis, como en contabilidad ("(200,00)").
 * - Un punto seguido de grupos de tres cifras ("1.234", "12.345") se entiende como separador de miles,
 *   salvo que empiece por cero ("0.125").
 */
export function leerNumero(texto: string): number | null {
  // Fuera espacios (también los de miles: "1 234,56") y el signo menos tipográfico de algunos programas
  const compacto = texto.replace(/[\s\u00a0\u202f]/g, "").replace(/[\u2212\u2013]/g, "-");
  const numero = /\d[\d.,]*/.exec(compacto);
  if (!numero) return null;
  const antes = compacto.slice(0, numero.index);
  const despues = compacto.slice(numero.index + numero[0].length);
  if (/\d/.test(despues)) return null;
  const negativo = antes.includes("-") || despues.startsWith("-") || (antes.includes("(") && despues.includes(")"));
  let limpio = numero[0].replace(/[.,]+$/, "");
  const coma = limpio.lastIndexOf(",");
  const punto = limpio.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) {
    const decimal = coma > punto ? "," : ".";
    const miles = decimal === "," ? "." : ",";
    limpio = limpio.split(miles).join("").replace(decimal, ".");
  } else if (coma >= 0) {
    limpio = limpio.split(",").length > 2 ? limpio.split(",").join("") : limpio.replace(",", ".");
  } else if (punto >= 0 && /^[1-9]\d{0,2}(\.\d{3})+$/.test(limpio)) {
    // "1.234" o "12.345.678": puntos de miles. "0.125" o "12.5" son decimales.
    limpio = limpio.split(".").join("");
  }
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  return negativo ? -Number(limpio) : Number(limpio);
}

export function leerImporte(texto: string): Centimos | null {
  const valor = leerNumero(texto);
  return valor === null ? null : Math.round(valor * 100);
}

/** Céntimos a texto editable en un formulario: 123456 → "1234,56". */
export function importeEditable(c: Centimos | null | undefined): string {
  if (c === null || c === undefined) return "";
  return (c / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");
}

export function numeroEditable(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).replace(".", ",");
}
