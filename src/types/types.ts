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
    products: string[];
    statusHistory: StatusHistoryInterface[];
}
