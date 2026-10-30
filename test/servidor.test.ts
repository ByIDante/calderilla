import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { Ajustes } from "../src/config/ajustes.ts";
import { Sincronizador } from "../src/datos/sync.ts";
import { crearApp, type Estado } from "../src/servidor/app.ts";
import { prepararBase } from "../src/servicios/semillas.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-servidor-"));
after(() => rmSync(carpeta, { recursive: true, force: true }));

const PUERTO = 5199;
const BASE = `http://127.0.0.1:${PUERTO}`;
const TOKEN = "token-de-prueba";

function crearEstado(): Estado {
  const ajustes: Ajustes = { carpetaDatos: null, equipoId: "aaaaaaaa", equipoNombre: "Pruebas", puerto: PUERTO, abrirNavegador: false, coingeckoClave: null };
  const estado: Estado = {
    ajustes,
    sync: null,
    token: TOKEN,
    hoy: () => "2026-10-30",
    errorFatal: null,
    usarCarpeta(datos) {
      estado.sync = new Sincronizador({ carpetaDatos: datos, rutaTrabajo: path.join(carpeta, "trabajo.db"), equipoId: "aaaaaaaa", equipoNombre: "Pruebas", alAbrir: prepararBase });
      estado.sync.comprobar();
      ajustes.carpetaDatos = datos;
    },
    guardarAjustes: () => {},
  };
  return estado;
}

const estado = crearEstado();
const app = crearApp(estado);

function pedir(ruta: string, opciones: { metodo?: string; cuerpo?: Record<string, string>; cabeceras?: Record<string, string>; conCookie?: boolean } = {}) {
  const cabeceras: Record<string, string> = { host: `127.0.0.1:${PUERTO}`, ...opciones.cabeceras };
  if (opciones.conCookie !== false) cabeceras.cookie = `calderilla=${TOKEN}`;
  if (opciones.cuerpo) cabeceras["content-type"] = "application/x-www-form-urlencoded";
  return app.request(`${BASE}${ruta}`, { method: opciones.metodo ?? "GET", headers: cabeceras, body: opciones.cuerpo ? new URLSearchParams(opciones.cuerpo).toString() : undefined });
}

describe("seguridad de la web local", () => {
  it("rechaza peticiones dirigidas a otro host (DNS rebinding)", async () => {
    const respuesta = await pedir("/", { cabeceras: { host: "atacante.com" } });
    assert.equal(respuesta.status, 403);
  });

  it("rechaza formularios enviados desde otra web", async () => {
    const respuesta = await pedir("/bienvenida", { metodo: "POST", cuerpo: { carpeta: "/tmp/x" }, cabeceras: { origin: "https://atacante.com" } });
    assert.equal(respuesta.status, 403);
  });

  it("rechaza cambios sin el token de este arranque", async () => {
    const respuesta = await pedir("/bienvenida", { metodo: "POST", cuerpo: { carpeta: "/tmp/x" }, conCookie: false });
    assert.equal(respuesta.status, 403);
  });

  it("al visitar una página entrega el token en una cookie SameSite=Strict", async () => {
    const respuesta = await pedir("/bienvenida", { conCookie: false });
    assert.match(respuesta.headers.get("set-cookie") ?? "", /calderilla=token-de-prueba;.*HttpOnly.*SameSite=Strict/i);
  });
});

describe("recorrido básico", () => {
  it("sin carpeta de datos lleva al asistente", async () => {
    const respuesta = await pedir("/");
    assert.equal(respuesta.status, 303);
    assert.equal(respuesta.headers.get("location"), "/bienvenida");
  });

  it("elige carpeta, apunta ingresos y gastos y calcula el resumen", async () => {
    const datos = path.join(carpeta, "Drive", "Calderilla");
    assert.equal((await pedir("/bienvenida", { metodo: "POST", cuerpo: { carpeta: datos }, cabeceras: { origin: BASE } })).status, 303);
    assert.ok(estado.sync);

    const nuevos: Record<string, string>[] = [
      { tipo: "ingreso", nombre: "Nómina", importe: "2.000", frecuencia: "mensual", inicio: "2024-01-28", fin_modo: "sin" },
      { tipo: "gasto", nombre: "Alquiler", importe: "700", frecuencia: "mensual", inicio: "2024-01-01", fin_modo: "sin", esencial: "1" },
      { tipo: "gasto", nombre: "Coche", prestamo: "1", capital: "15000", tin: "5,5", plazo: "60", inicio: "2024-03-05" },
      { tipo: "gasto", nombre: "Gimnasio", importe: "40", frecuencia: "mensual", inicio: "2025-01-10", fin_modo: "fecha", fin: "2026-09-10" },
    ];
    for (const cuerpo of nuevos) {
      const respuesta = await pedir("/gastos", { metodo: "POST", cuerpo });
      assert.equal(respuesta.status, 303, `guardar ${cuerpo.nombre}`);
    }

    const lista = await (await pedir("/gastos")).text();
    assert.match(lista, /Finalizados \(1\)/, "el gimnasio terminó en septiembre y pasa solo a Finalizados");
    assert.match(lista, /286,52/, "cuota del préstamo calculada");

    const resumen = await (await pedir("/")).text();
    assert.match(resumen, /Tu escalera de inversión/);
    assert.match(resumen, /Colchón mínimo|Fondo de emergencia/);
  });

  it("valida el formulario y no pierde lo escrito", async () => {
    const respuesta = await pedir("/gastos", { metodo: "POST", cuerpo: { tipo: "gasto", nombre: "Seguro coche", importe: "", frecuencia: "anual", inicio: "2027-02-01", fin_modo: "sin" } });
    assert.equal(respuesta.status, 200);
    const pagina = await respuesta.text();
    assert.match(pagina, /Indica el importe/);
    assert.match(pagina, /value="Seguro coche"/);
  });

  it("escapa lo que escribe el usuario", async () => {
    await pedir("/gastos", { metodo: "POST", cuerpo: { tipo: "gasto", nombre: "<script>alert(1)</script>", importe: "1", frecuencia: "mensual", inicio: "2026-01-01", fin_modo: "sin" } });
    const lista = await (await pedir("/gastos")).text();
    assert.ok(!lista.includes("<script>alert(1)</script>"));
    assert.match(lista, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it("todas las páginas responden", async () => {
    for (const ruta of ["/", "/gastos", "/gastos/nuevo", "/gastos/3/cuadro", "/ocio", "/cuentas", "/cierre", "/inversiones", "/metas", "/ajustes", "/ajustes/mercado", "/ajustes/parametros"]) {
      assert.equal((await pedir(ruta)).status, 200, ruta);
    }
  });

  it("cierra un mes con los saldos y guarda el plan", async () => {
    await pedir("/cuentas", { metodo: "POST", cuerpo: { nombre: "Nómina", tipo: "corriente", saldo: "1500", moneda: "EUR" } });
    const respuesta = await pedir("/cierre", { metodo: "POST", cuerpo: { mes: "2026-09", saldo_1: "1.200" } });
    assert.equal(respuesta.status, 303);
    const cierre = estado.sync!.bd.uno<{ mes: string; ahorro_real: number | null; patrimonio: number }>("SELECT * FROM cierres_mes");
    assert.equal(cierre?.mes, "2026-09");
    assert.equal(cierre?.ahorro_real, null, "el primer cierre no tiene con qué compararse");
    assert.equal(cierre?.patrimonio, 120000);
    estado.sync!.cerrar();
  });
});
