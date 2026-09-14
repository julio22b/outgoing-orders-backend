BEGIN;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_priority_check;
ALTER TABLE orders
    ADD CONSTRAINT orders_priority_check
    CHECK (priority IN ('low', 'normal', 'high'));

COMMIT;
