export const STATUS_TRANSITIONS: Record<string, string> = {
    picking: 'packed',
    packed: 'dispatched',
} as const;

export const ORDER_STATUSES = ['picking', 'packed', 'delayed', 'dispatched'] as const;

export const ORDER_PRIORITIES = ['low', 'normal', 'high'] as const;
