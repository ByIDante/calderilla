-- Gastos fijos descubiertos en los movimientos: con este texto (la «clave» del concepto) se reconocen sus cargos
ALTER TABLE recurrentes ADD COLUMN patron TEXT;

-- Traspasos entre tus propias cuentas: no son ni gasto ni ingreso.
-- NULL: sin decidir (se busca su pareja en la otra cuenta) · 1: es un traspaso · 0: no lo es (lo dijiste tú)
ALTER TABLE apuntes ADD COLUMN traspaso INTEGER;
ALTER TABLE apuntes ADD COLUMN traspaso_par INTEGER REFERENCES apuntes(id) ON DELETE SET NULL;
-- 1 si vinculaste o desvinculaste a mano el movimiento de su gasto fijo: la detección no lo deshace
ALTER TABLE apuntes ADD COLUMN vinculo_manual INTEGER NOT NULL DEFAULT 0;

-- Lo que encontró la detección y dijiste que no: no se vuelve a proponer
CREATE TABLE periodicos_ignorados (
  clave TEXT PRIMARY KEY,
  ignorado TEXT NOT NULL
);

-- Si se borra una mitad de un traspaso, la otra vuelve a quedar «sin decidir» para buscarle pareja otra vez
CREATE TRIGGER apuntes_traspaso_sin_pareja BEFORE DELETE ON apuntes
BEGIN
  UPDATE apuntes SET traspaso = NULL, traspaso_par = NULL WHERE traspaso_par = OLD.id;
END;
