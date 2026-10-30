import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { guardarBancos, guardarClave, leerBancos, sincronizarBancos } from "../src/bancos/conexiones.ts";
import { firmarToken, interpretarBancos, interpretarMovimientos, interpretarSaldo, interpretarSesion } from "../src/bancos/enablebanking.ts";
import { BaseDatos } from "../src/datos/db.ts";
import { prepararBase } from "../src/servicios/semillas.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-bancos-"));
process.env.CALDERILLA_CONFIG_DIR = carpeta;
const fetchOriginal = globalThis.fetch;
after(() => {
  globalThis.fetch = fetchOriginal;
  rmSync(carpeta, { recursive: true, force: true });
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

describe("Enable Banking", () => {
  it("firma el token como pide la API (RS256, kid = ID de la aplicación)", () => {
    const token = firmarToken("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", privateKey, Date.parse("2026-10-30T10:00:00Z"));
    const [cabecera = "", cuerpo = "", firma = ""] = token.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(cabecera, "base64url").toString()), { typ: "JWT", alg: "RS256", kid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString()) as { iss: string; aud: string; iat: number; exp: number };
    assert.equal(datos.iss, "enablebanking.com");
    assert.equal(datos.aud, "api.enablebanking.com");
    assert.equal(datos.exp - datos.iat, 3600);
    assert.ok(createVerify("RSA-SHA256").update(`${cabecera}.${cuerpo}`).verify(publicKey, Buffer.from(firma, "base64url")));
  });

  it("interpreta bancos, sesiones, saldos y movimientos", () => {
    assert.deepEqual(interpretarBancos({ aspsps: [{ name: "CaixaBank", country: "ES", maximum_consent_validity: 15_552_000 }] }), [{ nombre: "CaixaBank", pais: "ES", diasMaximos: 180 }]);
    const sesion = interpretarSesion({ session_id: "s1", access: { valid_until: "2027-04-28T10:00:00Z" }, accounts: [{ uid: "u1", account_id: { iban: "ES9121000418450200051332" }, name: "Cuenta nómina", currency: "EUR" }] });
    assert.equal(sesion.cuentas[0]?.iban, "ES9121000418450200051332");
    assert.equal(
      interpretarSaldo({ balances: [{ balance_type: "CLBD", balance_amount: { amount: "1000.00" } }, { balance_type: "ITAV", balance_amount: { amount: "950.50" } }] }),
      95050,
      "prefiere el saldo disponible",
    );
    const { movimientos, siguiente } = interpretarMovimientos({
      transactions: [
        { entry_reference: "r1", transaction_amount: { amount: "54.30" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-10-12", remittance_information: ["COMPRA MERCADONA"] },
        { entry_reference: "r2", transaction_amount: { amount: "2000.00" }, credit_debit_indicator: "CRDT", status: "BOOK", booking_date: "2026-10-28", debtor: { name: "EMPRESA SL" } },
        { entry_reference: "r3", transaction_amount: { amount: "9.99" }, credit_debit_indicator: "DBIT", status: "PDNG", booking_date: "2026-10-29" },
      ],
      continuation_key: "pagina2",
    });
    assert.deepEqual(
      movimientos.map((m) => [m.idExterno, m.importe, m.concepto]),
      [
        ["r1", -5430, "COMPRA MERCADONA"],
        ["r2", 200000, "EMPRESA SL"],
      ],
      "los pendientes no se traen",
    );
    assert.equal(siguiente, "pagina2");
  });

  it("sincroniza saldo y movimientos de todas las páginas sin duplicar", async () => {
    const bd = new BaseDatos(path.join(carpeta, "bancos.db"));
    prepararBase(bd);
    const cuentaId = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad) VALUES ('Nómina', 'corriente', 'CaixaBank')").id;
    guardarClave(privateKey);
    guardarBancos({
      appId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      conexiones: [{ sessionId: "s1", banco: "CaixaBank", pais: "ES", validoHasta: "2099-01-01T00:00:00Z", ultimaSincronizacion: null, cuentas: [{ uid: "u1", iban: null, nombre: null, moneda: "EUR", cuentaId }] }],
    });

    const peticiones: string[] = [];
    globalThis.fetch = (async (entrada: string | URL | Request) => {
      const url = new URL(String(entrada));
      peticiones.push(url.pathname + url.search);
      const responder = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("/balances")) return responder({ balances: [{ balance_type: "ITAV", balance_amount: { amount: "1500.00" } }] });
      if (url.searchParams.get("continuation_key") === "p2") {
        return responder({ transactions: [{ entry_reference: "r2", transaction_amount: { amount: "15.00" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-10-18", remittance_information: ["CINESA"] }] });
      }
      return responder({
        transactions: [{ entry_reference: "r1", transaction_amount: { amount: "54.30" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-10-12", remittance_information: ["MERCADONA"] }],
        continuation_key: "p2",
      });
    }) as typeof fetch;

    const informe = await sincronizarBancos(() => bd, "2026-10-30");
    assert.deepEqual(informe, { nuevos: 2, cuentas: 1, errores: [] });
    assert.ok(peticiones.some((p) => p.includes("date_from=2026-08-02")), "la primera vez pide los últimos 89 días");
    assert.equal(bd.uno<{ saldo: number }>("SELECT saldo FROM saldos WHERE cuenta_id = ?", cuentaId)?.saldo, 150000);
    const cine = bd.uno<{ tipo: string }>("SELECT c.tipo FROM apuntes a JOIN categorias c ON c.id = a.categoria_id WHERE a.concepto = 'CINESA'");
    assert.equal(cine?.tipo, "ocio", "categorizado con las reglas");

    assert.equal((await sincronizarBancos(() => bd, "2026-10-30")).nuevos, 0, "la segunda vez no duplica");
    assert.ok(leerBancos().conexiones[0]?.ultimaSincronizacion);
    bd.cerrar();
  });
});
