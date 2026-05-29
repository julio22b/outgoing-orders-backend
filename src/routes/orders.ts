import { Router } from 'express';
import { ordersController } from '../controllers/orders';

const ordersRouter = Router();

ordersRouter.get('/', ordersController.getAllOrders);

ordersRouter.get('/:id', ordersController.getOrder);

ordersRouter.post('/', ordersController.createOrder);

ordersRouter.put('/:id', ordersController.updateOrder);

ordersRouter.delete('/:id', ordersController.deleteOrder);

export default ordersRouter;
