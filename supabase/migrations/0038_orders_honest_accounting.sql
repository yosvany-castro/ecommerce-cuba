-- 0038: contabilidad honesta — el costo real de compra al proveedor no se
-- conoce al confirmar el pedido (se captura en preparación, cuando Yosvany
-- compra). El 60% inventado sale del sistema: costo NULL hasta tener el real.
-- margin_cents (generada: charged - cost) pasa a NULL en esos casos — honesto.
ALTER TABLE orders ALTER COLUMN total_cost_cents DROP NOT NULL;
ALTER TABLE order_items ALTER COLUMN unit_cost_cents DROP NOT NULL;

COMMENT ON COLUMN orders.total_charged_cents IS 'Cobro TOTAL al cliente: productos + envío + tax (desde 0038; antes solo productos)';
COMMENT ON COLUMN orders.total_cost_cents IS 'Costo real de compra al proveedor — NULL hasta capturarlo en preparación';
