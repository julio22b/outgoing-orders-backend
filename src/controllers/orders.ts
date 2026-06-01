import { Request, Response } from 'express';
import pool from '../db/index';
import { OutgoingOrderInterface, StatusHistoryInterface } from '../types/types';
import { QueryResult } from 'pg';

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

const getAllOrders = async (req: Request, res: Response<OutgoingOrderInterface[] | { message: string }>) => {
    try {
        const result: QueryResult<OutgoingOrderInterface> = await pool.query(`
      SELECT 
        orders.id,
        orders.customer,
        orders.status,
        orders.priority,
        orders.created_at,
        ARRAY_AGG(items.name) AS products,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'status', status_history.status,
            'timestamp', status_history.timestamp
          )
        ) AS "statusHistory"
      FROM orders
      LEFT JOIN items ON orders.id = items.order_id
      LEFT JOIN status_history ON orders.id = status_history.order_id
      GROUP BY orders.id
    `);

        res.status(200).json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

const getOrder = async (req: Request<OrderParams>, res: Response<OutgoingOrderInterface | { message: string }>) => {
    try {
        const result = await pool.query(
            `
        SELECT 
          orders.id,
          orders.customer,
          orders.status,
          orders.priority,
          orders.created_at,
          ARRAY_AGG(items.name) AS products,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'status', status_history.status,
              'timestamp', status_history.timestamp
            )
          ) AS "statusHistory"
        FROM orders
        LEFT JOIN items ON orders.id = items.order_id
        LEFT JOIN status_history ON orders.id = status_history.order_id
        WHERE orders.id = $1
        GROUP BY orders.id
        `,
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

        if (!customer || !status || !priority || !items.length || !createdAt) {
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

        const finalResult: QueryResult<OutgoingOrderInterface> = await client.query(
            `
            SELECT 
              orders.id,
              orders.customer,
              orders.status,
              orders.priority,
              orders.created_at AS "createdAt",
              ARRAY_AGG(items.name) AS products,
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'status', status_history.status,
                  'timestamp', status_history.timestamp
                )
              ) AS "statusHistory"
            FROM orders
            LEFT JOIN items ON orders.id = items.order_id
            LEFT JOIN status_history ON orders.id = status_history.order_id
            WHERE orders.id = $1
            GROUP BY orders.id
            `,
            [order.id],
        );

        await client.query('COMMIT');

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

        if (!customer || !status || !priority || !items.length || !createdAt) {
            return res.status(400).json({ message: 'Invalid request body' });
        }

        await client.query('BEGIN');

        const orderResult: QueryResult<OutgoingOrderInterface> = await client.query(
            `
            UPDATE orders
            SET customer = $1, status = $2, priority = $3
            WHERE orders.id = $4
            RETURNING *
            `,
            [customer, status, priority, id],
        );

        const updatedOrder = orderResult.rows[0];

        if (!updatedOrder) {
            return res.status(404).json({ message: 'Order not found' });
        }

        await client.query('DELETE FROM items WHERE order_id = $1', [id]);

        for (const item of items) {
            await client.query(
                `
            INSERT INTO items (name, order_id)
            VALUES ($1, $2)
            RETURNING *`,
                [item, updatedOrder.id],
            );
        }

        const finalResult: QueryResult<OutgoingOrderInterface> = await client.query(
            `
            SELECT 
              orders.id,
              orders.customer,
              orders.status,
              orders.priority,
              orders.created_at AS "createdAt",
              ARRAY_AGG(items.name) AS products,
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'status', status_history.status,
                  'timestamp', status_history.timestamp
                )
              ) AS "statusHistory"
            FROM orders
            LEFT JOIN items ON orders.id = items.order_id
            LEFT JOIN status_history ON orders.id = status_history.order_id
            WHERE orders.id = $1
            GROUP BY orders.id
            `,
            [id],
        );

        await client.query('COMMIT');

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

        res.status(200).json({ message: 'Order deleted successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        client.release();
    }
};

export const ordersController = { getAllOrders, getOrder, createOrder, updateOrder, deleteOrder };
