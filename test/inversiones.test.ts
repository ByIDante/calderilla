// Inversiones: borrar un movimiento de un activo borra ese movimiento, y nunca un apunte con el mismo número.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, describe, it } from "node:test";
import { appDePrueba } from "./ayuda-app.ts";

const { bd, pedir, carpeta, estado } = appDePrueba(4751);
after(() => {
  estado.sync?.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});

describe("movimientos de un activo", () => {
  it("«Borrar» borra el movimiento del activo y deja el apunte que tenga su mismo número", async () => {
    const fondo = bd.ejecutar("INSERT INTO activos (nombre, tipo, renta) VALUES ('Fondo indexado', 'fondo', 'variable')").id;
    const compra = bd.ejecutar("INSERT INTO movimientos_cartera (activo_id, fecha, tipo, cantidad, importe) VALUES (?, '2026-01-15', 'compra', 10, 100000)", fondo).id;
    // Un apunte con el mismo id que el movimiento del activo
    bd.ejecutar("INSERT INTO apuntes (id, fecha, importe, concepto) VALUES (?, '2026-10-02', -5430, 'MERCADONA')", compra);

    const pagina = await (await pedir(`/activos/${fondo}`)).text();
    assert.match(pagina, new RegExp(`action="/activos/movimientos/${compra}/borrar"`));
    const respuesta = await pedir(`/activos/movimientos/${compra}/borrar`, { volver: String(fondo) });
    assert.equal(respuesta.status, 303);
    assert.equal(respuesta.headers.get("location")?.split("?")[0], `/activos/${fondo}`);
    assert.equal(bd.uno<{ n: number }>("SELECT count(*) AS n FROM movimientos_cartera WHERE id = ?", compra)?.n, 0, "el movimiento del activo se borra");
    assert.ok(bd.uno("SELECT 1 FROM apuntes WHERE id = ?", compra), "el apunte sigue ahí");
  });
});
