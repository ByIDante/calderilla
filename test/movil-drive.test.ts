// El cliente de Google Drive del móvil contra un Drive falso: listar, subir, bajar, renombrar, papelera y permisos.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leerNombre } from "../src/datos/copias.ts";
import { buscarCarpetasCopias, CarpetaDrive, ClienteDrive, crearCarpetaCopias, SinPermisoDrive } from "../src/movil/sync/drive.ts";
import { driveFalso } from "./ayuda-carpetas.ts";

describe("Google Drive", () => {
  const conPermiso = () => Promise.resolve("bueno");

  it("lista página a página, sube y baja los bytes tal cual, renombra y manda a la papelera", async () => {
    const drive = driveFalso();
    const copias = drive.carpeta("copias");
    for (let i = 0; i < 7; i++) drive.archivo(`archivo-${i}.txt`, copias);
    const carpeta = new CarpetaDrive(new ClienteDrive(conPermiso, drive.pedir), copias);
    assert.equal((await carpeta.listar()).length, 7, "aunque Drive lo dé en varias páginas");
    const bytes = Uint8Array.from({ length: 256 * 4 }, (_, i) => i % 256);
    const subido = await carpeta.crear("000001-20260105090000-bbbbbbbb_de_inicio.db", bytes);
    assert.deepEqual(await carpeta.leer(subido), bytes);
    await carpeta.renombrar(subido, "otro-nombre.db");
    await carpeta.borrar({ id: "id2", nombre: "archivo-0.txt" });
    await carpeta.borrar({ id: "no-existe", nombre: "?" });
    assert.ok(drive.nombres(copias).includes("otro-nombre.db"));
    assert.ok(!drive.nombres(copias).includes("archivo-0.txt"), "a la papelera");
    assert.equal([...drive.archivos.values()].find((a) => a.name === "archivo-0.txt")?.trashed, true, "no se borra del todo: se puede recuperar");
  });

  it("sin permiso lo dice claro, para volver a conectar", async () => {
    const drive = driveFalso();
    const carpeta = new CarpetaDrive(new ClienteDrive(() => Promise.resolve("caducado"), drive.pedir), drive.carpeta("copias"));
    await assert.rejects(carpeta.listar(), SinPermisoDrive);
  });

  it("encuentra tus carpetas «copias» y, si no tienes, te crea una", async () => {
    const drive = driveFalso();
    const cliente = new ClienteDrive(conPermiso, drive.pedir);
    const buena = drive.carpeta("copias", drive.carpeta("Calderilla"));
    drive.archivo("000002-20261101100000-aaaaaaaa_de_000001-20261031100000-aaaaaaaa.db", buena);
    drive.archivo("000001-20261031100000-aaaaaaaa_de_inicio.db", buena);
    drive.archivo("notas.txt", buena);
    drive.carpeta("copias", drive.carpeta("Fotos"));
    const encontradas = await buscarCarpetasCopias(cliente, (nombre) => leerNombre(nombre) !== null);
    assert.deepEqual(
      encontradas.map((c) => [c.ruta, c.copias, c.ultima]),
      [
        ["Calderilla/copias", 2, "000002-20261101100000-aaaaaaaa_de_000001-20261031100000-aaaaaaaa.db"],
        ["Fotos/copias", 0, null],
      ],
    );
    const nueva = await crearCarpetaCopias(cliente);
    assert.equal(drive.archivos.get(nueva)?.name, "copias");
    assert.equal(drive.archivos.get(drive.archivos.get(nueva)!.parents[0]!)?.name, "Calderilla");
  });
});
