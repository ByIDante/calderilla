// Subir un archivo «en crudo»: en iPhone, el service worker recibe vacío el cuerpo de un formulario con archivo.
// La página manda el archivo solo, con el resto del formulario en esta cabecera, y el service worker lo rehace.

export const CABECERA_CRUDO = "X-Calderilla-Archivo";

export interface DatosCrudo {
  /** El campo del archivo, su nombre y su tipo. */
  campo: string;
  nombre: string;
  tipo: string;
  /** Los demás campos del formulario, en orden. */
  campos: [string, string][];
}
