-- Cobros cada semana, cada 2 semanas o dos veces al mes, y pagas extra de los ingresos.

-- SQLite no deja cambiar un CHECK: se rehace la tabla con las frecuencias nuevas. Las claves ajenas están
-- desactivadas durante las migraciones, así que borrar la tabla vieja no se lleva sus importes ni préstamos.
CREATE TABLE recurrentes_nueva (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'gasto')),
  nombre TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  frecuencia TEXT NOT NULL CHECK (frecuencia IN ('semanal', 'catorcenal', 'quincenal', 'mensual', 'trimestral', 'semestral', 'anual')),
  inicio TEXT NOT NULL,
  fin TEXT,
  esencial INTEGER NOT NULL DEFAULT 0,
  clase TEXT NOT NULL DEFAULT 'fijo' CHECK (clase IN ('fijo', 'estimacion')),
  nota TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  patron TEXT
);
INSERT INTO recurrentes_nueva (id, tipo, nombre, categoria_id, frecuencia, inicio, fin, esencial, clase, nota, creado, patron)
  SELECT id, tipo, nombre, categoria_id, frecuencia, inicio, fin, esencial, clase, nota, creado, patron FROM recurrentes;
DROP TABLE recurrentes;
ALTER TABLE recurrentes_nueva RENAME TO recurrentes;

-- Pagas extra de un ingreso (junio y diciembre, una cada 2 meses…). Se reparten mes a mes, como los gastos anuales.
-- meses: en qué meses llega, separados por comas ('6,12'). importe NULL: lo mismo que un cobro normal en ese
-- momento (así sigue las subidas de sueldo).
CREATE TABLE pagas_extra (
  id INTEGER PRIMARY KEY,
  recurrente_id INTEGER NOT NULL REFERENCES recurrentes(id) ON DELETE CASCADE,
  nombre TEXT,
  meses TEXT NOT NULL,
  importe INTEGER
);
CREATE INDEX pagas_extra_recurrente ON pagas_extra (recurrente_id);
