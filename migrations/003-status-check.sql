BEGIN;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
    ADD CONSTRAINT orders_status_check
    CHECK (status IN ('picking', 'packed', 'delayed', 'dispatched'));

ALTER TABLE status_history DROP CONSTRAINT IF EXISTS status_history_status_check;
ALTER TABLE status_history
    ADD CONSTRAINT status_history_status_check
    CHECK (status IN ('picking', 'packed', 'delayed', 'dispatched'));

COMMIT;
