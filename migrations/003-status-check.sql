BEGIN;

ALTER TABLE orders
    ADD CONSTRAINT orders_status_check
    CHECK (status IN ('picking', 'packed', 'delayed', 'dispatched'));

ALTER TABLE status_history
    ADD CONSTRAINT status_history_status_check
    CHECK (status IN ('picking', 'packed', 'delayed', 'dispatched'));

COMMIT;
