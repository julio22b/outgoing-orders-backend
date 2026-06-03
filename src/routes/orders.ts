import { Router } from 'express';
import { createOrdersController } from '../controllers/orders';
import { Server } from 'socket.io';

export default (io: Server) => {
    const router = Router();
    const controller = createOrdersController(io)

    router.get('/', controller.getAllOrders);

    router.get('/:id', controller.getOrder);

    router.post('/', controller.createOrder);

    router.put('/:id', controller.updateOrder);

    router.delete('/:id', controller.deleteOrder);

    return router
};
