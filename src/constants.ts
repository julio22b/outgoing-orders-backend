export const STATUS_TRANSITIONS: Record<string, string> = {
    picking: 'packed',
    packed: 'dispatched',
} as const;
