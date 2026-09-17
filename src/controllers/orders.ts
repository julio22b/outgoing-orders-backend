import { Request, Response } from 'express';
import pool from '../db/index';
import {
    OrderConflict,
    OrderPriority,
    OrderStatus,
    OrdersPage,
    OrdersSummary,
    OutgoingOrderInterface,
} from '../types/types';
import { PoolClient, QueryResult } from 'pg';
import { Server } from 'socket.io';
import { ORDER_PRIORITIES, ORDER_STATUSES, STATUS_TRANSITIONS } from '../constants';
import { getRandomCreatedAt, getRandomCustomer, getRandomItems, getRandomPriority } from '../utils';
import {
    BASE_ORDER_QUERY,
    buildOrderListQuery,
    buildOrderSummaryQuery,
    createNextCursor,
    isValidIsoDateTime,
    parseOrderFilters,
    parseOrderListParams,
} from './ordersQuery';

interface OrderParams {
    id: string;
}

interface CreateOrderBody {
    customer: string;
    status: OrderStatus;
    priority: OrderPriority;
    items: string[];
    createdAt: string;
}

interface UpdateOrderBody extends CreateOrderBody {
    id: string;
    version: number;
}

const readOrderById = async (client: PoolClient, id: string) => {
    const result: QueryResult<OutgoingOrderInterface> = await client.query(
        `${BASE_ORDER_QUERY} WHERE orders.id = $1`,
        [id],
    );
    return result.rows[0];
};

export const createOrdersController = (io: Server) => {
    const getAllOrders = async (req: Request, res: Response<OrdersPage | { message: string }>) => {
        try {
            const parsed = parseOrderListParams(req.query);

            if ('message' in parsed) {
                return res.status(400).json({ message: parsed.message });
            }

            const { params } = parsed;
            const { text, values } = buildOrderListQuery(params);
            const result: QueryResult<OutgoingOrderInterface & { cursorCreatedAt: string }> = await pool.query(
                text,
                values,
            );

            const hasNextPage = result.rows.length > params.limit;
            const pageRows = result.rows.slice(0, params.limit);
            const lastRow = pageRows[pageRows.length - 1];
            const nextCursor = hasNextPage ? createNextCursor(params, lastRow) : null;

            res.status(200).json({ data: pageRows.map(({ cursorCreatedAt, ...order }) => order), nextCursor });
        } catch (error) {
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    const getOrdersSummary = async (req: Request, res: Response<OrdersSummary | { message: string }>) => {
        try {
            const parsed = parseOrderFilters(req.query);

            if ('message' in parsed) {
                return res.status(400).json({ message: parsed.message });
            }

            const { text, values } = buildOrderSummaryQuery(parsed.params);
            const result: QueryResult<OrdersSummary> = await pool.query(text, values);

            res.status(200).json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    const getOrder = async (req: Request<OrderParams>, res: Response<OutgoingOrderInterface | { message: string }>) => {
        try {
            const result: QueryResult<OutgoingOrderInterface> = await pool.query(
                `${BASE_ORDER_QUERY} WHERE orders.id = $1`,
                [req.params.id],
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ message: 'Order not found' });
            }

            res.status(200).json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    const createOrder = async (
        req: Request<{}, any, CreateOrderBody>,
        res: Response<OutgoingOrderInterface | { message: string }>,
    ) => {
        const client = await pool.connect();
        try {
            const { customer, status, priority, items, createdAt } = req.body;

            if (!customer || !status || !priority || !items?.length || !createdAt) {
                return res.status(400).json({ message: 'Invalid request body' });
            }

            if (!ORDER_STATUSES.includes(status)) {
                return res.status(400).json({ message: `status must be one of: ${ORDER_STATUSES.join(', ')}` });
            }

            if (!ORDER_PRIORITIES.includes(priority)) {
                return res.status(400).json({ message: `priority must be one of: ${ORDER_PRIORITIES.join(', ')}` });
            }

            if (typeof createdAt !== 'string' || !isValidIsoDateTime(createdAt)) {
                return res.status(400).json({
                    message: 'createdAt must be an ISO-8601 date-time with an offset, e.g. 2026-01-01T00:00:00Z',
                });
            }

            await client.query('BEGIN');

            const orderResult: QueryResult<OutgoingOrderInterface> = await client.query(
                `
            INSERT INTO orders (customer, status, priority, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $4)
            RETURNING *
        `,
                [customer, status, priority, createdAt],
            );

            const order = orderResult.rows[0];

            for (const item of items) {
                await client.query(
                    `
            INSERT INTO items (name, order_id)
            VALUES ($1, $2)
            RETURNING *`,
                    [item, order.id],
                );
            }

            await client.query('INSERT INTO status_history (order_id, status, timestamp) VALUES ($1, $2, $3)', [
                order.id,
                status,
                createdAt,
            ]);

            const finalResult: QueryResult<OutgoingOrderInterface> = await client.query(
                `${BASE_ORDER_QUERY} WHERE orders.id = $1`,
                [order.id],
            );

            await client.query('COMMIT');
            io.emit('order:created', finalResult.rows[0]);
            res.status(201).json(finalResult.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            client.release();
        }
    };

    const updateOrder = async (
        req: Request<OrderParams, any, UpdateOrderBody>,
        res: Response<OutgoingOrderInterface | OrderConflict | { message: string }>,
    ) => {
        const client = await pool.connect();
        try {
            const { id } = req.params;
            const { customer, status, priority, items, createdAt, version } = req.body;

            if (!customer || !status || !priority || !items?.length || !createdAt) {
                return res.status(400).json({ message: 'Invalid request body' });
            }

            if (!ORDER_STATUSES.includes(status)) {
                return res.status(400).json({ message: `status must be one of: ${ORDER_STATUSES.join(', ')}` });
            }

            if (!ORDER_PRIORITIES.includes(priority)) {
                return res.status(400).json({ message: `priority must be one of: ${ORDER_PRIORITIES.join(', ')}` });
            }

            if (!Number.isInteger(version)) {
                return res.status(400).json({
                    message: 'version must be the integer version of the order being replaced',
                });
            }

            await client.query('BEGIN');

            const currentOrder = await client.query('SELECT status FROM orders WHERE id = $1', [id]);

            if (currentOrder.rows.length > 0 && currentOrder.rows[0].status !== status) {
                await client.query('INSERT INTO status_history (order_id, status, timestamp) VALUES ($1, $2, $3)', [
                    id,
                    status,
                    new Date(),
                ]);
            }

            const orderResult: QueryResult<OutgoingOrderInterface> = await client.query(
                `
            WITH updated_order AS (
                UPDATE orders
                SET customer = $1, status = $2, priority = $3, version = version + 1, updated_at = NOW()
                WHERE id = $4 AND version = $6
                RETURNING *
            ),
            deleted_items AS (
                DELETE FROM items WHERE order_id = $4 AND EXISTS (SELECT 1 FROM updated_order)
            ),
            inserted_items AS (
                INSERT INTO items (name, order_id)
                SELECT unnest($5::text[]), $4
                FROM updated_order
            )
            SELECT * FROM updated_order;
            `,
                [customer, status, priority, id, items, version],
            );

            if (orderResult.rows.length === 0) {
                await client.query('ROLLBACK');
                const winningOrder = await readOrderById(client, id);

                if (!winningOrder) {
                    return res.status(404).json({ message: 'Order not found' });
                }

                return res.status(409).json({
                    message: 'Order was modified by another write; reload and reapply your changes',
                    current: winningOrder,
                });
            }

            const finalResult: QueryResult<OutgoingOrderInterface> = await client.query(
                `${BASE_ORDER_QUERY} WHERE orders.id = $1`,
                [id],
            );

            await client.query('COMMIT');
            io.emit('order:updated', finalResult.rows[0]);

            res.status(200).json(finalResult.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            client.release();
        }
    };

    const deleteOrder = async (req: Request<OrderParams>, res: Response) => {
        const { id } = req.params;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            await client.query(
                `
            DELETE FROM ITEMS
            WHERE order_id = $1
            `,
                [id],
            );

            await client.query(
                `
            DELETE FROM status_history
            WHERE order_id = $1
            `,
                [id],
            );

            const result: QueryResult<OutgoingOrderInterface> = await client.query(
                `
            DELETE FROM orders
            WHERE orders.id = $1
            RETURNING *
            `,
                [id],
            );

            if (!result.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Order not found' });
            }

            await client.query('COMMIT');
            io.emit('order:deleted', result.rows[0].id);
            res.status(200).json({ message: 'Order deleted successfully' });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            client.release();
        }
    };

    const transitionOrderStatus = async (
        req: Request<OrderParams>,
        res: Response<OutgoingOrderInterface | OrderConflict | { message: string }>,
    ) => {
        const { id } = req.params;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const currentStatusResult = await client.query(
                `
                SELECT status FROM orders WHERE id = $1
                `,
                [id],
            );

            const currentStatus = currentStatusResult.rows[0]?.status;
            const nextStatus = STATUS_TRANSITIONS[currentStatus];

            if (!nextStatus) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Invalid status transition' });
            }

            const advanced = await client.query(
                `
                UPDATE orders
                SET status = $1, version = version + 1, updated_at = NOW()
                WHERE id = $2 AND status = $3
            `,
                [nextStatus, id, currentStatus],
            );

            if (advanced.rowCount === 0) {
                await client.query('ROLLBACK');
                const winningOrder = await readOrderById(client, id);

                if (!winningOrder) {
                    return res.status(404).json({ message: 'Order not found' });
                }

                return res.status(409).json({
                    message: 'Order status was advanced by another write',
                    current: winningOrder,
                });
            }

            await client.query(
                `
                INSERT INTO status_history
                (order_id, status, timestamp)
                VALUES ($1, $2, NOW())
                `,
                [id, nextStatus],
            );

            const updatedOrder = await readOrderById(client, id);

            await client.query('COMMIT');

            io.emit('order:updated', updatedOrder);
            res.status(200).json(updatedOrder);
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            client.release();
        }
    };

    const seedOrders = async (req: Request, res: Response) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(`DELETE FROM orders`);

            for (let i = 0; i < 15; i++) {
                const body: CreateOrderBody = {
                    customer: getRandomCustomer(),
                    status: 'picking',
                    priority: getRandomPriority(),
                    items: getRandomItems(),
                    createdAt: getRandomCreatedAt(),
                };

                const orderResult: QueryResult<OutgoingOrderInterface> = await client.query(
                    `INSERT INTO orders (customer, status, priority, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) RETURNING *`,
                    [body.customer, body.status, body.priority, body.createdAt],
                );

                const order = orderResult.rows[0];

                for (const item of body.items) {
                    await client.query(`INSERT INTO items (name, order_id) VALUES ($1, $2)`, [item, order.id]);
                }

                await client.query(`INSERT INTO status_history (order_id, status, timestamp) VALUES ($1, $2, $3)`, [
                    order.id,
                    body.status,
                    body.createdAt,
                ]);
            }

            await client.query('COMMIT');

            const ordersInPicking: QueryResult<OutgoingOrderInterface> = await client.query(
                `SELECT * FROM orders WHERE status = 'picking'`,
            );

            const shuffledOrdersInPicking = ordersInPicking.rows.sort(() => Math.random() - 0.5);
            const ordersToPack = shuffledOrdersInPicking.slice(0, 10);

            for (const order of ordersToPack)
                await fetch(`${process.env.BACKEND_URL}/orders/${order.id}/status`, {
                    method: 'PATCH',
                });

            const ordersInPacked: QueryResult<OutgoingOrderInterface> = await client.query(
                `SELECT * FROM orders WHERE status = 'packed'`,
            );

            const shuffledOrdersInPacked = ordersInPacked.rows.sort(() => Math.random() - 0.5);
            const ordersToDispatch = shuffledOrdersInPacked.slice(0, 5);

            for (const order of ordersToDispatch)
                await fetch(`${process.env.BACKEND_URL}/orders/${order.id}/status`, {
                    method: 'PATCH',
                });

            res.status(201).json({ message: 'Database seeded successfully' });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            client.release();
        }
    };

    return {
        getAllOrders,
        getOrdersSummary,
        getOrder,
        createOrder,
        updateOrder,
        deleteOrder,
        transitionOrderStatus,
        seedOrders,
    };
};
