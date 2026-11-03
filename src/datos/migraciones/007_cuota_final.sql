-- Préstamos con cuota final.

-- La cuota final de una financiación con valor futuro garantizado (coches, motos): el pago grande que llega
-- el mes siguiente a la última cuota normal. 0 si no tiene.
ALTER TABLE prestamos ADD COLUMN cuota_final INTEGER NOT NULL DEFAULT 0;
