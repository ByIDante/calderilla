// Construye la app del móvil en dist-movil/, tal cual se publica en Cloudflare Pages:
// - sw.js: la app entera (las mismas pantallas que el PC) en un solo archivo, con las migraciones dentro;
// - estatico/: los estilos y scripts de siempre, más movil.js y movil.css;
// - sqlite3.wasm, el manifiesto, los iconos, la página de arranque y las páginas legales.
// Falla si algo que solo existe en el PC (node:fs, node:path…) se cuela en lo que se ejecuta en el móvil.
//
//   node scripts/movil/construir.ts [versión]
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { migraciones } from "../../src/datos/migraciones.ts";

const raiz = path.join(import.meta.dirname, "..", "..");
export const SALIDA = path.join(raiz, "dist-movil");
const version = process.argv[2] ?? new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
const movil = path.join(raiz, "src", "movil");

rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(path.join(SALIDA, "estatico"), { recursive: true });
const copiar = (origen: string, destino: string) => cpSync(path.join(raiz, origen), path.join(SALIDA, destino));
copiar("src/estatico/estilos.css", "estatico/estilos.css");
copiar("src/estatico/app.js", "estatico/app.js");
copiar("src/estatico/icono.svg", "estatico/icono.svg");
copiar("node_modules/htmx.org/dist/htmx.min.js", "estatico/htmx.min.js");
copiar("node_modules/chart.js/dist/chart.umd.min.js", "estatico/chart.umd.min.js");
copiar("node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm", "sqlite3.wasm");
for (const archivo of readdirSync(path.join(movil, "estatico"))) {
  copiar(`src/movil/estatico/${archivo}`, archivo === "movil.css" ? "estatico/movil.css" : archivo);
}

/** Lo que el móvil necesita del PC, cambiado por lo suyo; cualquier otra cosa de Node es un error. */
const soloNavegador: Plugin = {
  name: "solo-navegador",
  setup(construccion) {
    const sustitutos: Record<string, string> = {
      "node:crypto": path.join(movil, "shims", "crypto.ts"),
      "node:sqlite": path.join(movil, "shims", "sqlite.ts"),
      "yahoo-finance2": path.join(movil, "shims", "yahoo.ts"),
    };
    construccion.onResolve({ filter: /^(node:|yahoo-finance2$)/ }, (args) =>
      sustitutos[args.path]
        ? { path: sustitutos[args.path] }
        : { errors: [{ text: `«${args.path}» solo existe en el PC y se ha colado en el móvil (lo usa ${path.relative(raiz, args.importer)}).` }] },
    );
    // Las migraciones se leen de archivos en el PC: en el móvil van dentro
    construccion.onLoad({ filter: /[\\/]src[\\/]datos[\\/]migraciones\.ts$/ }, () => ({
      contents: `export function migraciones() { return ${JSON.stringify(migraciones())}; }`,
      loader: "ts",
    }));
  },
};

/** Todo lo que hay en dist-movil salvo lo que no se pide desde la app: el service worker lo guarda al instalarse. */
function estaticos(): string[] {
  const lista: string[] = [];
  const recorrer = (carpeta: string) => {
    for (const nombre of readdirSync(carpeta)) {
      const ruta = path.join(carpeta, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else lista.push(`/${path.relative(SALIDA, ruta).split(path.sep).join("/")}`);
    }
  };
  recorrer(SALIDA);
  return [...lista, "/estatico/movil.js"].filter((r) => !["/_headers", "/index.html", "/privacidad.html", "/condiciones.html", "/legal.css"].includes(r)).sort();
}

const comun = {
  bundle: true,
  platform: "browser" as const,
  target: ["es2022", "safari16.4", "chrome110"],
  minify: true,
  sourcemap: true,
  legalComments: "none" as const,
  logLevel: "warning" as const,
  plugins: [soloNavegador],
};
await build({ ...comun, entryPoints: [path.join(movil, "pagina", "movil.ts")], outfile: path.join(SALIDA, "estatico", "movil.js"), format: "iife" });
await build({
  ...comun,
  entryPoints: [path.join(movil, "sw", "sw.ts")],
  outfile: path.join(SALIDA, "sw.js"),
  format: "iife",
  // sqlite-wasm busca su .wasm con import.meta.url: aquí se le dan los bytes (arrancarSqlite)
  define: { __VERSION__: JSON.stringify(version), __ESTATICOS__: JSON.stringify(estaticos()), "import.meta.url": "self.location.href" },
});
const peso = (archivo: string) => `${Math.round(statSync(path.join(SALIDA, archivo)).size / 1024)} KB`;
console.log(`App del móvil construida en ${SALIDA} (versión ${version}): sw.js ${peso("sw.js")}, movil.js ${peso("estatico/movil.js")}`);
