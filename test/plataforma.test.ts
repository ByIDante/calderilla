// Lo que el móvil cambia del PC sin tocarlo: el motor de SQLite de la base y lo propio de cada página.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { html } from "hono/html";
import { BaseDatos, VERSION_ESQUEMA } from "../src/datos/db.ts";
import { pagina, usarPlataforma } from "../src/servidor/vistas/comun.ts";

describe("la base con otro motor", () => {
  it("migra y marca los cambios igual que abriendo un archivo", () => {
    const bd = new BaseDatos("en memoria", { motor: new DatabaseSync(":memory:") });
    bd.migrar();
    assert.equal(bd.version(), VERSION_ESQUEMA);
    bd.transaccion(() => bd.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Cuenta', 'corriente')"));
    assert.equal(bd.leerMeta("sucio"), "1");
    bd.cerrar();
  });
});

describe("la página en otra plataforma", () => {
  it("sin cambios es la del PC; con ellos añade lo del móvil en su sitio", async () => {
    const pc = String(await pagina({ titulo: "Ocio", seccion: "ocio" }, html`<p>hola</p>`));
    assert.match(pc, /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/);
    assert.match(pc, /app\.js" defer><\/script>\n/);

    usarPlataforma({ viewport: "width=device-width, initial-scale=1, viewport-fit=cover", cabecera: html`<link rel="manifest" href="/manifest.webmanifest" />`, menu: (seccion) => html`<nav class="barra">${seccion}</nav>` });
    const movil = String(await pagina({ titulo: "Ocio", seccion: "ocio" }, html`<p>hola</p>`));
    assert.match(movil, /content="width=device-width, initial-scale=1, viewport-fit=cover"/);
    assert.match(movil, /app\.js" defer><\/script><link rel="manifest" href="\/manifest\.webmanifest" \/>\n\s*<\/head>/);
    assert.match(movil, /<\/nav><nav class="barra">ocio<\/nav>\n\s*<main id="contenido">/);
  });
});
