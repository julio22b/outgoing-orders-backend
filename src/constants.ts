export const STATUS_TRANSITIONS: Record<string, string> = {
    picking: 'packed',
    packed: 'dispatched',
} as const;

export const ORDER_PRIORITIES: Record<string, 'low' | 'normal' | 'high'> = {
    low: 'low',
    normal: 'normal',
    high: 'high',
} as const;
