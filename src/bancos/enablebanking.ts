import { createHash, createSign } from "node:crypto";
import type { Centimos } from "../dominio/dinero.ts";
import type { Fecha } from "../dominio/fechas.ts";

/*
 * Cliente de Enable Banking (open banking PSD2). Para uso personal es gratis en «modo restringido»: solo se
 * pueden leer las cuentas que vincula el propio dueño de la aplicación. Cada ordenador tiene su clave .pem
 * y sus sesiones; nada de esto va a la carpeta sincronizada ni al repositorio.
 * Documentación: https://enablebanking.com/docs/api/reference/
 */

const API = "https://api.enablebanking.com";
const TIEMPO_MAXIMO_MS = 30_000;

const base64url = (texto: string | Buffer) => Buffer.from(texto).toString("base64url");

/** Token JWT firmado con la clave privada de la aplicación (RS256), válido una hora. */
export function firmarToken(appId: string, clavePem: string, ahora = Date.now()): string {
  const iat = Math.floor(ahora / 1000);
  const cabecera = base64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const cuerpo = base64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 }));
  const firma = createSign("RSA-SHA256").update(`${cabecera}.${cuerpo}`).sign(clavePem);
  return `${cabecera}.${cuerpo}.${base64url(firma)}`;
}

export interface Banco {
  nombre: string;
  pais: string;
  /** Máximo que el banco deja autorizar, en días. */
  diasMaximos: number;
}

export interface CuentaBanco {
  uid: string;
  iban: string | null;
  nombre: string | null;
  moneda: string | null;
}

export interface Sesion {
  sessionId: string;
  validoHasta: string;
  cuentas: CuentaBanco[];
}

export interface MovimientoBanco {
  idExterno: string;
  fecha: Fecha;
  importe: Centimos;
  concepto: string;
}

export class ErrorBanco extends Error {}

export function interpretarBancos(json: unknown): Banco[] {
  const lista = (json as { aspsps?: { name: string; country: string; maximum_consent_validity?: number }[] }).aspsps ?? [];
  return lista
    .map((a) => ({ nombre: a.name, pais: a.country, diasMaximos: a.maximum_consent_validity ? Math.floor(a.maximum_consent_validity / 86_400) : 90 }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function interpretarSesion(json: unknown): Sesion {
  const s = json as {
    session_id: string;
    access?: { valid_until?: string };
    accounts?: { uid: string; account_id?: { iban?: string }; name?: string; product?: string; currency?: string }[];
  };
  return {
    sessionId: s.session_id,
    validoHasta: s.access?.valid_until ?? "",
    cuentas: (s.accounts ?? []).map((c) => ({ uid: c.uid, iban: c.account_id?.iban ?? null, nombre: c.name ?? c.product ?? null, moneda: c.currency ?? null })),
  };
}

/** El saldo disponible si el banco lo da; si no, el contable. */
const PREFERENCIA_SALDO = ["ITAV", "CLAV", "XPCD", "ITBD", "CLBD", "OPBD"];

export function interpretarSaldo(json: unknown): Centimos | null {
  const saldos = (json as { balances?: { balance_type?: string; balance_amount?: { amount: string } }[] }).balances ?? [];
  const ordenados = [...saldos].sort((a, b) => {
    const pa = PREFERENCIA_SALDO.indexOf(a.balance_type ?? "");
    const pb = PREFERENCIA_SALDO.indexOf(b.balance_type ?? "");
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
  const importe = ordenados[0]?.balance_amount?.amount;
  return importe === undefined ? null : Math.round(Number(importe) * 100);
}

interface TransaccionApi {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount?: { amount: string; currency?: string };
  credit_debit_indicator?: "CRDT" | "DBIT";
  status?: string;
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  creditor?: { name?: string };
  debtor?: { name?: string };
}

/** Solo movimientos ya contabilizados (los pendientes pueden cambiar o desaparecer). */
export function interpretarMovimientos(json: unknown): { movimientos: MovimientoBanco[]; siguiente: string | null } {
  const datos = json as { transactions?: TransaccionApi[]; continuation_key?: string | null };
  const movimientos: MovimientoBanco[] = [];
  const vistos = new Map<string, number>();
  for (const t of datos.transactions ?? []) {
    if (t.status && t.status !== "BOOK") continue;
    const fecha = t.booking_date ?? t.value_date ?? t.transaction_date;
    const cantidad = Number(t.transaction_amount?.amount);
    if (!fecha || !Number.isFinite(cantidad)) continue;
    // Sin indicador de cargo o abono, se respeta el signo del importe
    const importe = t.credit_debit_indicator ? Math.round(Math.abs(cantidad) * 100) * (t.credit_debit_indicator === "DBIT" ? -1 : 1) : Math.round(cantidad * 100);
    const contraparte = t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name;
    const concepto = [...(t.remittance_information ?? []), contraparte].filter(Boolean).join(" · ") || "(sin concepto)";
    // Si el banco no da referencia, se construye una con los datos del movimiento y su número de orden
    // (dos cafés iguales el mismo día son dos movimientos)
    const clave = `${fecha}|${importe}|${concepto}`;
    const orden = (vistos.get(clave) ?? 0) + 1;
    vistos.set(clave, orden);
    const idExterno = t.entry_reference ?? t.transaction_id ?? createHash("sha1").update(`${clave}|${orden}`).digest("hex");
    movimientos.push({ idExterno, fecha: fecha.slice(0, 10), importe, concepto });
  }
  return { movimientos, siguiente: datos.continuation_key || null };
}

export class EnableBanking {
  readonly #appId: string;
  readonly #clave: string;

  constructor(appId: string, clavePem: string) {
    this.#appId = appId;
    this.#clave = clavePem;
  }

  async #pedir(metodo: "GET" | "POST" | "DELETE", ruta: string, cuerpo?: unknown): Promise<unknown> {
    const respuesta = await fetch(`${API}${ruta}`, {
      method: metodo,
      headers: { authorization: `Bearer ${firmarToken(this.#appId, this.#clave)}`, "content-type": "application/json", accept: "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    const texto = await respuesta.text();
    if (!respuesta.ok) {
      let detalle = texto.slice(0, 300);
      try {
        const error = JSON.parse(texto) as { message?: string; detail?: unknown };
        detalle = error.message ?? JSON.stringify(error.detail ?? error);
      } catch {
        // la respuesta no era JSON: se muestra tal cual
      }
      throw new ErrorBanco(`Enable Banking respondió ${respuesta.status}: ${detalle}`);
    }
    return texto ? JSON.parse(texto) : null;
  }

  async bancos(pais = "ES"): Promise<Banco[]> {
    return interpretarBancos(await this.#pedir("GET", `/aspsps?country=${pais}&psu_type=personal&service=AIS`));
  }

  /** Devuelve la dirección del banco donde autorizas el acceso. */
  async iniciar(banco: Banco, redireccion: string, estado: string): Promise<string> {
    const dias = Math.min(banco.diasMaximos, 180);
    const respuesta = (await this.#pedir("POST", "/auth", {
      access: { valid_until: new Date(Date.now() + dias * 86_400_000).toISOString() },
      aspsp: { name: banco.nombre, country: banco.pais },
      state: estado,
      redirect_url: redireccion,
      psu_type: "personal",
    })) as { url: string };
    return respuesta.url;
  }

  async crearSesion(codigo: string): Promise<Sesion> {
    return interpretarSesion(await this.#pedir("POST", "/sessions", { code: codigo }));
  }

  async borrarSesion(sessionId: string): Promise<void> {
    await this.#pedir("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async saldo(uid: string): Promise<Centimos | null> {
    return interpretarSaldo(await this.#pedir("GET", `/accounts/${encodeURIComponent(uid)}/balances`));
  }

  async movimientos(uid: string, desde: Fecha): Promise<MovimientoBanco[]> {
    const todos: MovimientoBanco[] = [];
    let clave: string | null = null;
    // Se recorren todas las páginas, con un tope por si el banco devolviera siempre la misma
    for (let pagina = 0; pagina < 50; pagina++) {
      const consulta = new URLSearchParams({ date_from: desde });
      if (clave) consulta.set("continuation_key", clave);
      const { movimientos, siguiente } = interpretarMovimientos(await this.#pedir("GET", `/accounts/${encodeURIComponent(uid)}/transactions?${consulta}`));
      todos.push(...movimientos);
      if (!siguiente) break;
      clave = siguiente;
    }
    return todos;
  }
}
