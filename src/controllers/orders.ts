import { Request, Response } from 'express';

const getAllOrders = (req: Request, res: Response) => {
    console.log('get all orders');
};

const getOrder = (req: Request, res: Response) => {
    console.log('get order');
};

const createOrder = (req: Request, res: Response) => {
    console.log('create order');
};

const updateOrder = (req: Request, res: Response) => {
    console.log('update order');
};

const deleteOrder = (req: Request, res: Response) => {
    console.log('delete order');
};

export const ordersController = { getAllOrders, getOrder, createOrder, updateOrder, deleteOrder };
