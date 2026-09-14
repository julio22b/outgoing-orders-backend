import type { ORDER_PRIORITIES, ORDER_STATUSES } from '../constants';

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export interface StatusHistoryInterface {
    status: OrderStatus;
    timestamp: string;
}

export interface OutgoingOrderInterface {
    id: number;
    customer: string;
    status: OrderStatus;
    priority: OrderPriority;
    createdAt: string;
    items: string[];
    statusHistory: StatusHistoryInterface[];
}

export interface OrdersPage {
    data: OutgoingOrderInterface[];
    nextCursor: string | null;
}

export interface OrdersSummary {
    total: number;
    byStatus: Record<OrderStatus, number>;
}
