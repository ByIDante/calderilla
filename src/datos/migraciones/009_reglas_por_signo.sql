-- Reglas de categoría que valen solo para pagos o solo para cobros: lo que pagas a una persona y lo que te
-- devuelve pueden ir a categorías distintas. SQLite no deja cambiar un UNIQUE: se rehace la tabla.

-- todos: cualquier movimiento · gasto: solo pagos · ingreso: solo cobros
CREATE TABLE reglas_categoria_nueva (
  id INTEGER PRIMARY KEY,
  patron TEXT NOT NULL,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  signo TEXT NOT NULL DEFAULT 'todos' CHECK (signo IN ('todos', 'gasto', 'ingreso')),
  UNIQUE (patron, signo)
);
INSERT INTO reglas_categoria_nueva (id, patron, categoria_id) SELECT id, patron, categoria_id FROM reglas_categoria;
DROP TABLE reglas_categoria;
ALTER TABLE reglas_categoria_nueva RENAME TO reglas_categoria;
