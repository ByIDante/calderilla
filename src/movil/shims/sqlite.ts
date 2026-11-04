// node:sqlite en el móvil: no existe. La base usa SQLite en WebAssembly (movil/sqlite/motor.ts), que se le da hecha.
export class DatabaseSync {
  constructor() {
    throw new Error("En el móvil la base se abre con SQLite en WebAssembly, no con node:sqlite.");
  }
}
