// Construye la prueba en dist-prueba/: el service worker en un solo archivo, la página y lo estático.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const raiz = path.join(import.meta.dirname, "..");
const salida = path.join(raiz, "dist-prueba");
const version = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

const comun = { bundle: true, platform: "browser" as const, target: ["es2022", "safari16.4", "chrome110"], minify: true, sourcemap: true, logLevel: "warning" as const };
// sqlite-wasm busca su .wasm con import.meta.url: aquí se le da el wasm a mano (instantiateWasm)
await build({ ...comun, entryPoints: [path.join(import.meta.dirname, "sw.ts")], outfile: path.join(salida, "sw.js"), format: "iife", define: { __VERSION__: JSON.stringify(version), "import.meta.url": "self.location.href" } });
await build({ ...comun, entryPoints: [path.join(import.meta.dirname, "pagina.ts")], outfile: path.join(salida, "pagina.js"), format: "iife" });
cpSync(path.join(raiz, "node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm"), path.join(salida, "sqlite3.wasm"));
cpSync(path.join(import.meta.dirname, "estatico"), salida, { recursive: true });
console.log(`Prueba construida en ${salida} (versión ${version})`);
