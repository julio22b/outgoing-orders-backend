import { Request, Response } from 'express';
import pool from '../db/index';
import { OutgoingOrderInterface } from '../types/types';
import { QueryResult } from 'pg';
import { Server } from 'socket.io';
import { ORDER_PRIORITIES, STATUS_TRANSITIONS } from '../constants';
import { getRandomCreatedAt, getRandomCustomer, getRandomItems, getRandomPriority } from '../utils';

interface OrderParams {
    id: string;
}

interface CreateOrderBody {
    customer: string;
    status: 'picking' | 'packed' | 'delayed' | 'dispatched';
    priority: 'low' | 'normal' | 'high';
    items: string[];
    createdAt: string;
}

interface UpdateOrderBody extends CreateOrderBody {
    id: string;
}

const BASE_ORDER_QUERY = `
    SELECT 
        orders.id,
        orders.customer,
        orders.status,
        orders.priority,
        orders.created_at AS "createdAt",
        COALESCE(i.items, '{}') AS items,
        COALESCE(sh.status_history, '[]'::json) AS "statusHistory"
    FROM orders
    LEFT JOIN (
        SELECT order_id, ARRAY_AGG(name) AS items
        FROM items
        GROUP BY order_id
    ) i ON orders.id = i.order_id
    LEFT JOIN (
        SELECT order_id, JSON_AGG(
            JSON_BUILD_OBJECT('status', status, 'timestamp', timestamp)
        ) AS status_history
        FROM status_history
        GROUP BY order_id
    ) sh ON orders.id = sh.order_id
`;

export const createOrdersController = (io: Server) => {
    const getAllOrders = async (req: Request, res: Response<OutgoingOrderInterface[] | { message: string }>) => {
        try {
            const result: QueryResult<OutgoingOrderInterface> = await pool.query(BASE_ORDER_QUERY);

            res.status(200).json(result.rows);
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

            await client.query('BEGIN');

            const orderResult: QueryResult<OutgoingOrderInterface> = await client.query(
                `
            INSERT INTO orders (customer, status, priority, created_at)
            VALUES ($1, $2, $3, $4)
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

    const updateOrder = async (req: Request<OrderParams, any, UpdateOrderBody>, res: Response) => {
        const client = await pool.connect();
        try {
            const { id } = req.params;
            const { customer, status, priority, items, createdAt } = req.body;

            if (!customer || !status || !priority || !items?.length || !createdAt) {
                return res.status(400).json({ message: 'Invalid request body' });
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
                SET customer = $1, status = $2, priority = $3
                WHERE id = $4
                RETURNING *
            ),
            deleted_items AS (
                DELETE FROM items WHERE order_id = $4
            ),
            inserted_items AS (
                INSERT INTO items (name, order_id)
                SELECT unnest($5::text[]), $4
                FROM updated_order
            )
            SELECT * FROM updated_order;
            `,
                [customer, status, priority, id, items],
            );

            if (orderResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Order not found' });
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

    const transitionOrderStatus = async (req: Request<OrderParams>, res: Response) => {
        const { id } = req.params;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const currentStatus = await client.query(
                `
                SELECT status FROM orders WHERE id = $1
                `,
                [id],
            );

            const nextStatus = STATUS_TRANSITIONS[currentStatus.rows[0]?.status];

            if (!nextStatus) {
                return res.status(400).json({ message: 'Invalid status transition' });
            }

            await client.query(
                `
                UPDATE orders
                SET status = $1
                WHERE id = $2
            `,
                [nextStatus, id],
            );

            await client.query(
                `
                INSERT INTO status_history
                (order_id, status, timestamp)
                VALUES ($1, $2, NOW())
                `,
                [id, nextStatus],
            );

            const updatedOrder: QueryResult<OutgoingOrderInterface> = await client.query(
                `${BASE_ORDER_QUERY} WHERE orders.id = $1`,
                [id],
            );

            await client.query('COMMIT');

            io.emit('order:updated', updatedOrder.rows[0]);
            res.status(200).json({ message: 'Order status updated successfully' });
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
                    `INSERT INTO orders (customer, status, priority, created_at) VALUES ($1, $2, $3, $4) RETURNING *`,
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

    return { getAllOrders, getOrder, createOrder, updateOrder, deleteOrder, transitionOrderStatus, seedOrders };
};
