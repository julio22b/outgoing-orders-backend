export interface StatusHistoryInterface {
    status: 'picking' | 'packed' | 'delayed' | 'dispatched';
    timestamp: string;
}

export interface OutgoingOrderInterface {
    id: number;
    customer: string;
    status: string;
    priority: string;
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
    byStatus: Record<StatusHistoryInterface['status'], number>;
}
