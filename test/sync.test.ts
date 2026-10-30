import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BaseDatos } from "../src/datos/db.ts";
import { cabezas, copiasSobrantes, decidir, leerNombre, nombreCopia, Sincronizador, type Copia } from "../src/datos/sync.ts";

const temporales: string[] = [];
after(() => temporales.forEach((carpeta) => rmSync(carpeta, { recursive: true, force: true })));

function carpetaTemporal(): string {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-sync-"));
  temporales.push(carpeta);
  return carpeta;
}

function copia(gen: number, marca: string, equipo: string, padre: string | null): Copia {
  return leerNombre(nombreCopia(gen, marca, equipo, padre))!;
}

describe("nombres y decisiones", () => {
  const raiz = copia(1, "20261001100000", "aaaaaaaa", null);
  const hijaA = copia(2, "20261002100000", "aaaaaaaa", raiz.id);
  const hijaB = copia(2, "20261002110000", "bbbbbbbb", raiz.id);

  it("lee y escribe nombres de copia", () => {
    assert.equal(raiz.archivo, "000001-20261001100000-aaaaaaaa_de_inicio.db");
    assert.equal(hijaA.padre, raiz.id);
    assert.equal(leerNombre("foto.db"), null);
    assert.equal(leerNombre(hijaA.archivo.replace(".db", ".descartada.db")), null);
  });

  it("decide qué hacer en cada caso", () => {
    assert.deepEqual(decidir([], { base: null, sucio: false }), { tipo: "enviar" });
    assert.deepEqual(decidir([raiz], { base: null, sucio: false }), { tipo: "descargar", copia: raiz });
    assert.deepEqual(decidir([raiz], { base: raiz.id, sucio: false }), { tipo: "nada" });
    assert.deepEqual(decidir([raiz], { base: raiz.id, sucio: true }), { tipo: "enviar" });
    assert.deepEqual(decidir([raiz, hijaA], { base: raiz.id, sucio: false }), { tipo: "descargar", copia: hijaA });
    assert.equal(decidir([raiz, hijaA], { base: raiz.id, sucio: true }).tipo, "conflicto", "cambios aquí y allí");
    assert.equal(decidir([raiz, hijaA, hijaB], { base: hijaA.id, sucio: false }).tipo, "conflicto", "dos ordenadores guardaron a la vez");
    assert.deepEqual(cabezas([raiz, hijaA, hijaB]).map((c) => c.id), [hijaB.id, hijaA.id]);
  });

  it("al podar conserva la última semana, una por día, una por mes, las cabezas y la base", () => {
    const ahora = new Date("2026-10-30T12:00:00Z");
    const copias: Copia[] = [];
    let padre: string | null = null;
    // Cuatro copias al día durante 60 días
    for (let dia = 60; dia >= 0; dia--) {
      for (const hora of ["08", "12", "16", "20"]) {
        const fecha = new Date(ahora.getTime() - dia * 86_400_000);
        const marca = `${fecha.toISOString().slice(0, 10).replace(/-/g, "")}${hora}0000`;
        if (marca > "20261030120000") continue;
        const nueva = copia(copias.length + 1, marca, "aaaaaaaa", padre);
        copias.push(nueva);
        padre = nueva.id;
      }
    }
    const base = copias[10]!.id;
    const sobrantes = new Set(copiasSobrantes(copias, base, ahora).map((c) => c.id));
    const conservadas = copias.filter((c) => !sobrantes.has(c.id));
    assert.ok(!sobrantes.has(base), "la base no se borra");
    assert.ok(!sobrantes.has(copias.at(-1)!.id), "la cabeza no se borra");
    assert.ok(conservadas.filter((c) => c.marca >= "20261023").length >= 28, "toda la última semana");
    assert.equal(conservadas.filter((c) => c.marca.startsWith("20261010")).length, 1, "una del día 10");
    assert.ok(conservadas.filter((c) => c.marca.startsWith("202609") && c.marca < "20260930").length <= 2, "en septiembre, fuera de los 30 días, solo la del mes (y la base)");
  });
});

describe("dos ordenadores con una carpeta sincronizada", () => {
  // Cada ordenador ve su propia carpeta; `sincronizar` imita a Drive copiando lo nuevo de una a otra
  const compartidaA = carpetaTemporal();
  const compartidaB = carpetaTemporal();
  const sincronizar = (desde: string, hasta: string, espejo = false) => {
    if (espejo) rmSync(path.join(hasta, "copias"), { recursive: true, force: true });
    cpSync(path.join(desde, "copias"), path.join(hasta, "copias"), { recursive: true, force: false, errorOnExist: false });
  };

  const crear = (compartida: string, equipoId: string, equipoNombre: string) =>
    new Sincronizador({
      carpetaDatos: compartida,
      rutaTrabajo: path.join(carpetaTemporal(), "trabajo.db"),
      equipoId,
      equipoNombre,
      alAbrir: (bd: BaseDatos) => bd.migrar(),
    });

  const nombres = (s: Sincronizador) => s.bd.todos<{ nombre: string }>("SELECT nombre FROM categorias ORDER BY nombre").map((f) => f.nombre);
  const apuntar = (s: Sincronizador, nombre: string) => s.bd.ejecutar("INSERT INTO categorias (nombre, tipo) VALUES (?, 'otro')", nombre);

  const portatil = crear(compartidaA, "aaaaaaaa", "Portátil");
  const sobremesa = crear(compartidaB, "bbbbbbbb", "Sobremesa");

  it("el primero crea la copia inicial y el segundo la trae", () => {
    apuntar(portatil, "Vivienda");
    assert.equal(portatil.comprobar()?.tipo, "enviar");
    sincronizar(compartidaA, compartidaB);
    sobremesa.bd.escribirMeta("sucio", "0");
    assert.equal(sobremesa.comprobar()?.tipo, "descargar");
    assert.deepEqual(nombres(sobremesa), ["Vivienda"]);
  });

  it("los cambios viajan de uno a otro", () => {
    apuntar(sobremesa, "Ocio");
    assert.equal(sobremesa.comprobar()?.tipo, "enviar");
    sincronizar(compartidaB, compartidaA);
    assert.equal(portatil.comprobar()?.tipo, "descargar");
    assert.deepEqual(nombres(portatil), ["Ocio", "Vivienda"]);
    assert.match(portatil.aviso ?? "", /Sobremesa/);
  });

  it("si los dos guardan antes de que Drive sincronice, avisa en vez de perder cambios", () => {
    // Viernes: el portátil guarda, pero se cierra antes de que su copia suba
    apuntar(portatil, "Viajes");
    assert.equal(portatil.comprobar()?.tipo, "enviar");
    // Sábado: el sobremesa no ve esa copia, edita y guarda la suya
    apuntar(sobremesa, "Coche");
    assert.equal(sobremesa.comprobar()?.tipo, "enviar");
    // Lunes: Drive sube por fin la copia del viernes
    sincronizar(compartidaA, compartidaB);
    sincronizar(compartidaB, compartidaA);
    assert.equal(portatil.comprobar()?.tipo, "conflicto");
    assert.equal(sobremesa.comprobar()?.tipo, "conflicto");
    assert.equal(portatil.estado.tipo, "conflicto");

    // En el portátil se elige la versión del sobremesa
    const versiones = portatil.estado.tipo === "conflicto" ? portatil.estado.versiones : [];
    const delSobremesa = versiones.find((v) => v.equipo === "bbbbbbbb")!;
    assert.equal(portatil.resumen(delSobremesa).equipo, "Sobremesa");
    portatil.resolver(delSobremesa.archivo);
    assert.deepEqual(nombres(portatil), ["Coche", "Ocio", "Vivienda"]);
    assert.equal(portatil.estado.tipo, "ok");
    // La versión descartada sigue en la carpeta, apartada
    assert.ok(readdirSync(path.join(compartidaA, "copias")).some((archivo) => archivo.endsWith(".descartada.db")));

    sincronizar(compartidaA, compartidaB, true);
    assert.equal(sobremesa.comprobar()?.tipo, "nada");
    assert.deepEqual(nombres(sobremesa), ["Coche", "Ocio", "Vivienda"]);
  });

  it("quedarse con la versión local la envía y aparta las demás", () => {
    apuntar(portatil, "Regalos");
    portatil.comprobar();
    apuntar(sobremesa, "Mascotas");
    sobremesa.comprobar();
    sincronizar(compartidaA, compartidaB);
    sincronizar(compartidaB, compartidaA);
    assert.equal(sobremesa.comprobar()?.tipo, "conflicto");
    sobremesa.resolver("local");
    assert.equal(sobremesa.estado.tipo, "ok");
    sincronizar(compartidaB, compartidaA, true);
    assert.equal(portatil.comprobar()?.tipo, "descargar");
    assert.ok(nombres(portatil).includes("Mascotas"));
    assert.ok(!nombres(portatil).includes("Regalos"));
    portatil.cerrar();
    sobremesa.cerrar();
  });
});
