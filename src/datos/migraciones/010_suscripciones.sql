-- Tus suscripciones: si un gasto fijo lo es. NULL: lo decide la app (por su nombre o su categoría) · 1: sí · 0: no
-- (lo dijiste tú).
ALTER TABLE recurrentes ADD COLUMN suscripcion INTEGER;
