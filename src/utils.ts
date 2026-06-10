import { ORDER_PRIORITIES } from './constants';

export const getRandomItems = () => {
    const items = [
        'Cardboard Box 40x30x20',
        'Bubble Wrap Roll',
        'Packing Tape',
        'Wooden Pallet',
        'Stretch Film Roll',
        'Label Printer Paper',
        'Safety Gloves',
        'Barcode Scanner',
        'Plastic Bin 60L',
        'Foam Corner Guards',
        'Zip Ties Pack',
        'Warehouse Labels A4',
        'Hand Truck',
        'Shrink Wrap Bag',
        'Desiccant Packets',
    ];

    const shuffled = items.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.floor(Math.random() * 4) + 1);
};

export const getRandomPriority = () => {
    const priorities = Object.values(ORDER_PRIORITIES);
    return priorities[Math.floor(Math.random() * priorities.length)];
};

export const getRandomCreatedAt = () => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    return new Date(sevenDaysAgo + Math.random() * (now - sevenDaysAgo)).toISOString();
};

const CUSTOMERS = [
    'Acme Logistics',
    'Bright Supply Co.',
    'Delta Freight',
    'Evergreen Wholesale',
    'Falcon Distribution',
    'Global Trade Inc.',
    'Harbor Goods',
    'Iron Ridge Supply',
    'Jetstream Commerce',
    'Keystone Exports',
    'Lantern Group',
    'Metro Fulfillment',
    'Nexus Warehousing',
    'Orbit Retail',
    'Pacific Rim Traders',
];

export const getRandomCustomer = () => CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)];
