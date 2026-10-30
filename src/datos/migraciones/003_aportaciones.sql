-- Ahorro automático: traspasos periódicos a una cuenta de ahorro o compras periódicas de un fondo.
-- No son gastos: son la forma de cumplir el ahorro que pide la escalera.

CREATE TABLE aportaciones (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  cuenta_id INTEGER REFERENCES cuentas(id) ON DELETE CASCADE,
  activo_id INTEGER REFERENCES activos(id) ON DELETE CASCADE,
  importe INTEGER NOT NULL,
  dia INTEGER NOT NULL DEFAULT 1 CHECK (dia BETWEEN 1 AND 31),
  inicio TEXT NOT NULL,
  fin TEXT,
  CHECK ((cuenta_id IS NULL) <> (activo_id IS NULL))
);

-- Lo que de verdad se aportó cada mes (0 si ese mes no se hizo). En un fondo, la compra que generó.
CREATE TABLE aportaciones_mes (
  aportacion_id INTEGER NOT NULL REFERENCES aportaciones(id) ON DELETE CASCADE,
  mes TEXT NOT NULL,
  importe INTEGER NOT NULL,
  movimiento_id INTEGER REFERENCES movimientos_cartera(id) ON DELETE SET NULL,
  PRIMARY KEY (aportacion_id, mes)
);
