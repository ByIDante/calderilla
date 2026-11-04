// Lo que sustituye en el móvil a node:crypto, node:sqlite y Yahoo: el SHA-1 tiene que dar lo mismo que en el PC,
// porque se guarda en la base y se compara entre equipos.
import assert from "node:assert/strict";
import { createHash as hashNode } from "node:crypto";
import { describe, it } from "node:test";
import { createHash, randomBytes } from "../src/movil/shims/crypto.ts";
import { DatabaseSync } from "../src/movil/shims/sqlite.ts";
import YahooFinance from "../src/movil/shims/yahoo.ts";

const enNode = (...partes: string[]) => partes.reduce((h, p) => h.update(p), hashNode("sha1")).digest("hex");
const enMovil = (...partes: string[]) => partes.reduce((h, p) => h.update(p), createHash("sha1")).digest("hex");

describe("SHA-1 del móvil", () => {
  it("da lo mismo que node:crypto", () => {
    const textos = [
      "",
      "abc",
      "2026-10-02|-5430|COMPRA SUPERMERCADO|1",
      "Bizum enviado · Nombre;Apellido Apellido",
      "Ñandú, cigüeña y 12,99 € de café ☕ 👍🏽",
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(63),
      "x".repeat(64),
      "x".repeat(65),
      "€".repeat(1000),
      Array.from({ length: 5000 }, (_, i) => String.fromCodePoint(32 + ((i * 7919) % 5000))).join(""),
    ];
    for (const texto of textos) assert.equal(enMovil(texto), enNode(texto), JSON.stringify(texto.slice(0, 40)));
    assert.equal(enMovil("base|", "orden"), enNode("base|orden"), "por partes, igual que todo junto");
    assert.equal(createHash("sha1").update(new TextEncoder().encode("abc")).digest("hex"), enNode("abc"));
  });

  it("solo hace lo que usa el código común, y lo dice si se le pide otra cosa", () => {
    assert.throws(() => createHash("sha256"), /solo hay SHA-1/);
    assert.match(randomBytes(12).toString("hex"), /^[0-9a-f]{24}$/);
    assert.notEqual(randomBytes(16).toString("hex"), randomBytes(16).toString("hex"));
  });
});

describe("lo que no hay en el móvil", () => {
  it("node:sqlite y Yahoo avisan en lugar de fallar sin explicación", async () => {
    assert.throws(() => new DatabaseSync(), /WebAssembly/);
    await assert.rejects(new YahooFinance({}).search(), /desde el ordenador/);
    await assert.rejects(new YahooFinance({}).chart(), /desde el ordenador/);
  });
});
