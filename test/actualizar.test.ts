import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { after, it } from "node:test";
import { esPaquete, instalarVersion, leerTar, ultimaVersion } from "../src/config/actualizar.ts";
import { versionInstalada } from "../src/config/version.ts";

const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-actualizar-"));
const fetchOriginal = globalThis.fetch;
after(() => {
  globalThis.fetch = fetchOriginal;
  rmSync(carpeta, { recursive: true, force: true });
});

const SHA = "1".repeat(40);

/** Un .tar como los de GitHub: cabecera pax global con el commit, carpetas, archivos y rutas largas en pax. */
function cabecera(nombre: string, tamano: number, tipo: string): Buffer {
  const bloque = Buffer.alloc(512);
  bloque.write(nombre.slice(0, 100), 0, "utf8");
  bloque.write("0000644\0", 100);
  bloque.write(`${tamano.toString(8).padStart(11, "0")}\0`, 124);
  bloque.write("        ", 148);
  bloque.write(tipo, 156);
  bloque.write("ustar\0" + "00", 257);
  const suma = bloque.reduce((total, byte) => total + byte, 0);
  bloque.write(`${suma.toString(8).padStart(6, "0")}\0 `, 148);
  return bloque;
}
function entrada(nombre: string, contenido: string | null, tipo = contenido === null ? "5" : "0"): Buffer {
  const datos = Buffer.from(contenido ?? "");
  return Buffer.concat([cabecera(nombre, datos.length, tipo), datos, Buffer.alloc((512 - (datos.length % 512)) % 512)]);
}
function pax(clave: string, valor: string): string {
  const resto = ` ${clave}=${valor}\n`;
  let largo = resto.length + 1;
  while (String(largo).length + resto.length !== largo) largo++;
  return `${largo}${resto}`;
}
function tar(...partes: Buffer[]): Buffer {
  return Buffer.concat([...partes, Buffer.alloc(1024)]);
}

const rutaLarga = `calderilla-${SHA}/src/${"muy-largo/".repeat(12)}archivo.ts`;
const descarga = tar(
  entrada("pax_global_header", pax("comment", SHA), "g"),
  entrada(`calderilla-${SHA}/`, null),
  entrada(`calderilla-${SHA}/package.json`, '{"name":"calderilla"}'),
  entrada(`calderilla-${SHA}/package-lock.json`, "igual"),
  entrada(`calderilla-${SHA}/Calderilla.cmd`, "nuevo\r\n"),
  entrada(`calderilla-${SHA}/src/`, null),
  entrada(`calderilla-${SHA}/src/main.ts`, "// nueva"),
  entrada("PaxHeader", pax("path", rutaLarga), "x"),
  entrada(rutaLarga.slice(0, 100), "largo"),
  entrada(`calderilla-${SHA}/../fuera.txt`, "no"),
);

it("lee los .tar de GitHub, también las rutas largas", () => {
  const entradas = leerTar(descarga);
  assert.deepEqual(
    entradas.map((e) => [e.ruta, e.datos?.toString() ?? null]),
    [
      [`calderilla-${SHA}/`, null],
      [`calderilla-${SHA}/package.json`, '{"name":"calderilla"}'],
      [`calderilla-${SHA}/package-lock.json`, "igual"],
      [`calderilla-${SHA}/Calderilla.cmd`, "nuevo\r\n"],
      [`calderilla-${SHA}/src/`, null],
      [`calderilla-${SHA}/src/main.ts`, "// nueva"],
      [rutaLarga, "largo"],
      [`calderilla-${SHA}/../fuera.txt`, "no"],
    ],
  );
});

it("pregunta a GitHub por el último commit y, sin respuesta válida, no inventa nada", async () => {
  globalThis.fetch = (async () => new Response(`${SHA}\n`)) as typeof fetch;
  assert.equal(await ultimaVersion(), SHA);
  globalThis.fetch = (async () => new Response("<html>límite</html>")) as typeof fetch;
  assert.equal(await ultimaVersion(), null);
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  assert.equal(await ultimaVersion(), null);
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.equal(await ultimaVersion(), null);
});

it("el paquete para Windows instala la versión nueva sin tocar Node, las dependencias ni lo que no cambia", async () => {
  const raiz = path.join(carpeta, "Calderilla");
  mkdirSync(path.join(raiz, "src"), { recursive: true });
  mkdirSync(path.join(raiz, "node_modules", "hono"), { recursive: true });
  mkdirSync(path.join(raiz, "node"), { recursive: true });
  writeFileSync(path.join(raiz, "package.json"), "{}");
  writeFileSync(path.join(raiz, "package-lock.json"), "igual");
  utimesSync(path.join(raiz, "package-lock.json"), new Date("2026-01-01"), new Date("2026-01-01"));
  writeFileSync(path.join(raiz, "Calderilla.cmd"), "viejo\r\n");
  writeFileSync(path.join(raiz, "src", "main.ts"), "// vieja");
  writeFileSync(path.join(raiz, "src", "quitado.ts"), "// ya no existe");
  writeFileSync(path.join(raiz, "node_modules", "hono", "index.js"), "hono");
  writeFileSync(path.join(raiz, "node", "node.exe"), "node");
  writeFileSync(path.join(raiz, "VERSION"), `${"0".repeat(40)}\n`);
  assert.ok(esPaquete(raiz));
  assert.equal(versionInstalada(raiz), "0".repeat(40), "sin .git, la versión sale del archivo VERSION");

  let pedida = "";
  globalThis.fetch = (async (url: string | URL | Request) => {
    pedida = String(url);
    return new Response(gzipSync(descarga));
  }) as typeof fetch;
  await instalarVersion(raiz, SHA);

  assert.equal(pedida, `https://github.com/ByIDante/calderilla/archive/${SHA}.tar.gz`);
  assert.equal(readFileSync(path.join(raiz, "src", "main.ts"), "utf8"), "// nueva");
  assert.equal(existsSync(path.join(raiz, "src", "quitado.ts")), false, "lo que ya no está en la versión nueva desaparece");
  assert.equal(readFileSync(path.join(raiz, "Calderilla.cmd"), "utf8"), "nuevo\r\n");
  assert.equal(readFileSync(path.join(raiz, rutaLarga.split("/").slice(1).join("/")), "utf8"), "largo");
  assert.equal(statSync(path.join(raiz, "package-lock.json")).mtime.getFullYear(), 2026, "igual que antes: no se toca");
  assert.equal(statSync(path.join(raiz, "package-lock.json")).mtime.getMonth(), 0, "y conserva su fecha, así no se reinstalan las dependencias");
  assert.equal(readFileSync(path.join(raiz, "node_modules", "hono", "index.js"), "utf8"), "hono");
  assert.equal(readFileSync(path.join(raiz, "node", "node.exe"), "utf8"), "node");
  assert.equal(existsSync(path.join(carpeta, "fuera.txt")), false, "nada se escribe fuera de la carpeta");
  assert.equal(existsSync(path.join(raiz, ".actualizacion")), false);
  assert.equal(existsSync(path.join(raiz, ".actualizacion-anterior")), false);
  assert.equal(versionInstalada(raiz), SHA);

  // Si la descarga falla, todo se queda como estaba
  globalThis.fetch = (async () => new Response("", { status: 502 })) as typeof fetch;
  await assert.rejects(instalarVersion(raiz, "2".repeat(40)), /502/);
  assert.equal(readFileSync(path.join(raiz, "src", "main.ts"), "utf8"), "// nueva");
  assert.equal(versionInstalada(raiz), SHA);

  // Una copia de git no es el paquete: la actualiza git
  mkdirSync(path.join(raiz, ".git"));
  assert.equal(esPaquete(raiz), false);
});
