import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import type { Ajustes } from "../src/config/ajustes.ts";
import { guardarBancos, guardarClave, leerBancos } from "../src/bancos/conexiones.ts";
import { Sincronizador } from "../src/datos/sync.ts";
import { crearApp, type Estado } from "../src/servidor/app.ts";
import { prepararBase } from "../src/servicios/semillas.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-renovar-"));
process.env.CALDERILLA_CONFIG_DIR = carpeta;
const fetchOriginal = globalThis.fetch;
after(() => {
  globalThis.fetch = fetchOriginal;
  rmSync(carpeta, { recursive: true, force: true });
});

it("renovar el permiso de un banco reutiliza sus cuentas y no duplica nada", async () => {
  const ajustes: Ajustes = { carpetaDatos: null, equipoId: "aaaaaaaa", equipoNombre: "Pruebas", puerto: 5198, abrirNavegador: false, coingeckoClave: null };
  const estado: Estado = { ajustes, sync: null, token: "t", hoy: () => "2026-10-30", errorFatal: null, usarCarpeta: () => {}, guardarAjustes: () => {} };
  estado.sync = new Sincronizador({ carpetaDatos: path.join(carpeta, "datos"), rutaTrabajo: path.join(carpeta, "trabajo.db"), equipoId: "aaaaaaaa", equipoNombre: "Pruebas", alAbrir: prepararBase });
  const bd = estado.sync.bd;
  const cuentaId = bd.ejecutar("INSERT INTO cuentas (nombre, tipo, entidad) VALUES ('CaixaBank Nómina', 'corriente', 'CaixaBank')").id;
  guardarClave(generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey);
  guardarBancos({
    appId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    conexiones: [
      { sessionId: "vieja", banco: "CaixaBank", pais: "ES", validoHasta: "2026-11-05T00:00:00Z", ultimaSincronizacion: "2026-10-29T08:00:00Z", cuentas: [{ uid: "u-viejo", iban: "ES91", nombre: "Nómina", moneda: "EUR", cuentaId }] },
    ],
  });

  let estadoAutorizacion = "";
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const responder = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/aspsps") return responder({ aspsps: [{ name: "CaixaBank", country: "ES", maximum_consent_validity: 15_552_000 }] });
    if (url.pathname === "/auth") {
      estadoAutorizacion = (JSON.parse(String(init?.body)) as { state: string }).state;
      return responder({ url: "https://banco.example/autorizar" });
    }
    if (url.pathname === "/sessions") {
      return responder({ session_id: "nueva", access: { valid_until: "2027-04-28T00:00:00Z" }, accounts: [{ uid: "u-nuevo", account_id: { iban: "ES91" }, name: "Nómina", currency: "EUR" }] });
    }
    if (url.pathname.endsWith("/balances")) return responder({ balances: [{ balance_type: "ITAV", balance_amount: { amount: "1000.00" } }] });
    return responder({ transactions: [{ entry_reference: "r1", transaction_amount: { amount: "40.00" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-10-29", remittance_information: ["CINE"] }] });
  }) as typeof fetch;

  const app = crearApp(estado);
  const cabeceras = { host: "127.0.0.1:5198", cookie: "calderilla=t", "content-type": "application/x-www-form-urlencoded" };
  const conectar = await app.request("http://127.0.0.1:5198/bancos/conectar", { method: "POST", headers: cabeceras, body: "banco=CaixaBank" });
  assert.equal(conectar.status, 200);
  assert.ok(estadoAutorizacion);
  const vuelta = await app.request(`http://127.0.0.1:5198/bancos/volver?code=c&state=${estadoAutorizacion}`, { headers: { host: "127.0.0.1:5198" } });
  assert.equal(vuelta.status, 303);

  assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM cuentas")?.n, 1, "no crea otra cuenta");
  const config = leerBancos();
  assert.deepEqual(
    config.conexiones.map((c) => [c.sessionId, c.cuentas[0]?.cuentaId]),
    [["nueva", cuentaId]],
    "la conexión nueva sustituye a la vieja y apunta a la misma cuenta",
  );

  // Tras probar, se puede desvincular borrando lo que trajo; lo apuntado a mano se queda
  const otra = bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Mía', 'corriente')").id;
  bd.ejecutar("INSERT INTO apuntes (fecha, importe, concepto) VALUES ('2026-10-10', -1000, 'A MANO')");
  assert.ok((bd.uno<{ n: number }>("SELECT count(*) AS n FROM apuntes WHERE origen = 'banco'")?.n ?? 0) > 0);
  const desvincular = await app.request("http://127.0.0.1:5198/bancos/desvincular", { method: "POST", headers: cabeceras, body: "sesion=nueva&borrar=1" });
  assert.equal(desvincular.status, 303);
  assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM apuntes WHERE origen = 'banco'")?.n, 0);
  assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM apuntes WHERE concepto = 'A MANO'")?.n, 1);
  assert.equal(bd.uno("SELECT 1 FROM cuentas WHERE id = ?", cuentaId), undefined, "la cuenta que solo tenía datos del banco desaparece");
  assert.ok(bd.uno("SELECT 1 FROM cuentas WHERE id = ?", otra), "las demás cuentas no se tocan");
  assert.equal(leerBancos().conexiones.length, 0);
  estado.sync.cerrar();
});
