-- Gastos compartidos (lo que te devuelven por Bizum).

-- Una entrada que te devuelve parte de un gasto (pagaste la cena de todos): el gasto cuenta solo lo tuyo.
-- devolucion_manual = 1 si lo decidiste tú (unirla, separarla o decir que no): la detección no lo cambia.
ALTER TABLE apuntes ADD COLUMN devuelve_a INTEGER REFERENCES apuntes(id) ON DELETE SET NULL;
ALTER TABLE apuntes ADD COLUMN devolucion_manual INTEGER NOT NULL DEFAULT 0;
CREATE INDEX apuntes_devuelve_a ON apuntes (devuelve_a);
