/** Un archivo de la carpeta de copias: en Drive el nombre no es único, así que se le habla por su id. */
export interface ArchivoCarpeta {
  id: string;
  nombre: string;
}

/**
 * La carpeta de copias vista desde el móvil (en Google Drive; en los tests, una carpeta del disco). Es la misma
 * carpeta que el PC ve sincronizada por rclone o por Google Drive para ordenador.
 */
export interface Carpeta {
  /** Los archivos que hay (sin los de la papelera). */
  listar(): Promise<ArchivoCarpeta[]>;
  leer(archivo: ArchivoCarpeta): Promise<Uint8Array>;
  /** Crea un archivo con su nombre definitivo y todo su contenido de una vez: nadie lo ve a medias. */
  crear(nombre: string, bytes: Uint8Array): Promise<ArchivoCarpeta>;
  renombrar(archivo: ArchivoCarpeta, nombre: string): Promise<void>;
  /** Lo quita de la carpeta (en Drive, a la papelera). Si ya no estaba, no pasa nada. */
  borrar(archivo: ArchivoCarpeta): Promise<void>;
}

/** El archivo ya no está (otro equipo lo ha podado o apartado entretanto). */
export class ArchivoQueNoEsta extends Error {}
