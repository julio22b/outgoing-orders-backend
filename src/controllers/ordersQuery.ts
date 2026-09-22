import { createHash } from 'crypto';
import { Request } from 'express';
import { ORDER_PRIORITIES, ORDER_STATUSES } from '../constants';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const MAX_SEARCH_LENGTH = 100;
const MIN_CUSTOMER_SEARCH_LENGTH = 3;
const POSTGRES_INT_MAX = 2147483647;
const FILTERS_FINGERPRINT_LENGTH = 16;

const SORT_FIELDS = ['createdAt', 'id'] as const;
const SORT_DIRECTIONS = ['asc', 'desc'] as const;
const VALID_STATUSES: readonly string[] = ORDER_STATUSES;
const VALID_PRIORITIES: readonly string[] = ORDER_PRIORITIES;

const ISO_DATETIME_WITH_OFFSET_PATTERN =
    /^([1-9]\d{3})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:0\d|1[0-5]):?[0-5]\d)$/;
const ORDER_ID_SEARCH_PATTERN = /^(?:ord-?)?(\d+)$/i;
const ORDER_ID_PATTERN = /^\d+$/;

const CURSOR_CREATED_AT_COLUMN = `TO_CHAR(orders.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"`;

const MISSING = undefined;
const INVALID = null;

type SortField = (typeof SORT_FIELDS)[number];
type SortDirection = (typeof SORT_DIRECTIONS)[number];
type RequestQuery = Request['query'];
type ParseResult<T> = { params: T } | { message: string };
type AddQueryParam = (value: unknown) => string;

export interface OrderFilters {
    priorities: string[];
    searchTerm?: string;
    createdAtFrom?: string;
    createdAtTo?: string;
}

type OrderListFilters = OrderFilters & { statuses: string[] };

export interface PageCursor {
    sortField: SortField;
    sortDirection: SortDirection;
    filtersFingerprint: string;
    lastId: number;
    lastCreatedAt?: string;
}

export interface OrderListParams extends OrderListFilters {
    sortField: SortField;
    sortDirection: SortDirection;
    limit: number;
    cursor?: PageCursor;
}

export const buildOrderQuery = (ordersSource: string, extraSelectColumn?: string) => `
    SELECT
        orders.id,
        orders.customer,
        orders.status,
        orders.priority,
        orders.created_at AS "createdAt",
        orders.version,
        orders.updated_at AS "updatedAt",
        COALESCE(order_items.item_names, '{}') AS items,
        COALESCE(order_history.history_entries, '[]'::json) AS "statusHistory"${extraSelectColumn ? `,\n        ${extraSelectColumn}` : ''}
    FROM ${ordersSource} orders
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(items.name ORDER BY items.id) AS item_names
        FROM items
        WHERE items.order_id = orders.id
    ) order_items ON TRUE
    LEFT JOIN LATERAL (
        SELECT JSON_AGG(
            JSON_BUILD_OBJECT('status', status_history.status, 'timestamp', status_history.timestamp)
            ORDER BY status_history.timestamp, status_history.id
        ) AS history_entries
        FROM status_history
        WHERE status_history.order_id = orders.id
    ) order_history ON TRUE
`;

export const BASE_ORDER_QUERY = buildOrderQuery('orders');

const isOneOf = <T extends string>(allowedValues: readonly T[], value: unknown): value is T =>
    typeof value === 'string' && (allowedValues as readonly string[]).includes(value);

export const isValidIsoDateTime = (value: string) => {
    const match = ISO_DATETIME_WITH_OFFSET_PATTERN.exec(value);
    if (!match) {
        return false;
    }
    const [year, month, day] = match.slice(1, 4).map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    return calendarDate.getUTCMonth() === month - 1 && calendarDate.getUTCDate() === day;
};

export const parseOrderId = (id: string): number | typeof INVALID => {
    if (!ORDER_ID_PATTERN.test(id)) {
        return INVALID;
    }
    const orderId = Number(id);
    return orderId > 0 && orderId <= POSTGRES_INT_MAX ? orderId : INVALID;
};

const readSingleValue = (queryValue: unknown): string | typeof MISSING | typeof INVALID => {
    if (queryValue === undefined) {
        return MISSING;
    }
    if (typeof queryValue !== 'string') {
        return INVALID;
    }
    return queryValue.trim() || MISSING;
};

const readCommaSeparatedList = (queryValue: unknown): string[] | typeof INVALID => {
    if (queryValue === undefined) {
        return [];
    }
    const repeatedValues: unknown[] = Array.isArray(queryValue) ? queryValue : [queryValue];
    if (!repeatedValues.every((value): value is string => typeof value === 'string')) {
        return INVALID;
    }
    const listedValues = repeatedValues
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
    return listedValues.length > 0 ? listedValues : INVALID;
};

const readAllowedValue = <T extends string>(
    queryValue: unknown,
    allowedValues: readonly T[],
    defaultValue: T,
): T | typeof INVALID => {
    const value = readSingleValue(queryValue);
    if (value === MISSING) {
        return defaultValue;
    }
    return isOneOf(allowedValues, value) ? value : INVALID;
};

const readIsoDateTime = (queryValue: unknown): string | typeof MISSING | typeof INVALID => {
    const value = readSingleValue(queryValue);
    if (value === MISSING || value === INVALID) {
        return value;
    }
    return isValidIsoDateTime(value) ? value : INVALID;
};

const readPageLimit = (queryValue: unknown): number | typeof INVALID => {
    const limitText = readSingleValue(queryValue);
    if (limitText === MISSING) {
        return DEFAULT_PAGE_LIMIT;
    }
    if (limitText === INVALID || !/^\d+$/.test(limitText)) {
        return INVALID;
    }
    const limit = Number(limitText);
    return limit >= 1 && limit <= MAX_PAGE_LIMIT ? limit : INVALID;
};

const fingerprintFilters = (filters: OrderListFilters) => {
    const normalizedFilters = {
        statuses: [...new Set(filters.statuses)].sort(),
        priorities: [...new Set(filters.priorities)].sort(),
        searchTerm: filters.searchTerm ?? null,
        createdAtFrom: filters.createdAtFrom ?? null,
        createdAtTo: filters.createdAtTo ?? null,
    };
    return createHash('sha256')
        .update(JSON.stringify(normalizedFilters))
        .digest('base64url')
        .slice(0, FILTERS_FINGERPRINT_LENGTH);
};

const encodeCursor = (cursor: PageCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export const createNextCursor = (params: OrderListParams, lastRow: { id: number; cursorCreatedAt: string }) =>
    encodeCursor({
        sortField: params.sortField,
        sortDirection: params.sortDirection,
        filtersFingerprint: fingerprintFilters(params),
        lastId: lastRow.id,
        lastCreatedAt: params.sortField === 'createdAt' ? lastRow.cursorCreatedAt : undefined,
    });

const decodeCursor = (cursorText: string): PageCursor | typeof INVALID => {
    let decoded: unknown;
    try {
        decoded = JSON.parse(Buffer.from(cursorText, 'base64url').toString('utf8'));
    } catch {
        return INVALID;
    }
    if (typeof decoded !== 'object' || decoded === null) {
        return INVALID;
    }
    const { sortField, sortDirection, filtersFingerprint, lastId, lastCreatedAt } = decoded as Record<string, unknown>;
    if (!isOneOf(SORT_FIELDS, sortField) || !isOneOf(SORT_DIRECTIONS, sortDirection)) {
        return INVALID;
    }
    if (typeof filtersFingerprint !== 'string') {
        return INVALID;
    }
    if (typeof lastId !== 'number' || !Number.isInteger(lastId) || lastId < 1 || lastId > POSTGRES_INT_MAX) {
        return INVALID;
    }
    if (sortField === 'id') {
        return { sortField, sortDirection, filtersFingerprint, lastId };
    }
    return typeof lastCreatedAt === 'string' && isValidIsoDateTime(lastCreatedAt)
        ? { sortField, sortDirection, filtersFingerprint, lastId, lastCreatedAt }
        : INVALID;
};

export const parseOrderFilters = (query: RequestQuery): ParseResult<OrderFilters> => {
    const priorities = readCommaSeparatedList(query.priority);
    if (priorities === INVALID || priorities.some((priority) => !VALID_PRIORITIES.includes(priority))) {
        return { message: `priority must be a non-empty comma-separated list of: ${VALID_PRIORITIES.join(', ')}` };
    }

    const searchTerm = readSingleValue(query.search);
    if (searchTerm === INVALID || (searchTerm && searchTerm.length > MAX_SEARCH_LENGTH)) {
        return { message: `search must be a single value of at most ${MAX_SEARCH_LENGTH} characters` };
    }
    if (searchTerm && !ORDER_ID_SEARCH_PATTERN.test(searchTerm) && searchTerm.length < MIN_CUSTOMER_SEARCH_LENGTH) {
        return {
            message: `search must be an order id (123 or ORD-123) or at least ${MIN_CUSTOMER_SEARCH_LENGTH} characters of a customer name`,
        };
    }

    const createdAtFrom = readIsoDateTime(query.from);
    const createdAtTo = readIsoDateTime(query.to);
    if (createdAtFrom === INVALID || createdAtTo === INVALID) {
        return { message: 'from and to must be ISO-8601 date-times with an offset, e.g. 2026-01-01T00:00:00Z' };
    }

    return { params: { priorities, searchTerm, createdAtFrom, createdAtTo } };
};

export const parseOrderListParams = (query: RequestQuery): ParseResult<OrderListParams> => {
    const filters = parseOrderFilters(query);
    if ('message' in filters) {
        return filters;
    }

    const statuses = readCommaSeparatedList(query.status);
    if (statuses === INVALID || statuses.some((status) => !VALID_STATUSES.includes(status))) {
        return { message: `status must be a non-empty comma-separated list of: ${VALID_STATUSES.join(', ')}` };
    }

    const sortField = readAllowedValue(query.sort, SORT_FIELDS, 'createdAt');
    if (sortField === INVALID) {
        return { message: `sort must be one of: ${SORT_FIELDS.join(', ')}` };
    }

    const sortDirection = readAllowedValue(query.dir, SORT_DIRECTIONS, 'desc');
    if (sortDirection === INVALID) {
        return { message: `dir must be one of: ${SORT_DIRECTIONS.join(', ')}` };
    }

    const limit = readPageLimit(query.limit);
    if (limit === INVALID) {
        return { message: `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}` };
    }

    const listParams: OrderListParams = { ...filters.params, statuses, sortField, sortDirection, limit };

    const cursorText = readSingleValue(query.cursor);
    if (cursorText === MISSING) {
        return { params: listParams };
    }

    const decodedCursor = cursorText === INVALID ? INVALID : decodeCursor(cursorText);
    if (decodedCursor === INVALID) {
        return { message: 'cursor is invalid' };
    }
    if (decodedCursor.sortField !== sortField || decodedCursor.sortDirection !== sortDirection) {
        return { message: 'cursor was issued for a different sort or dir; drop it when either changes' };
    }
    if (decodedCursor.filtersFingerprint !== fingerprintFilters(listParams)) {
        return { message: 'cursor was issued for different filters; drop it when filters change' };
    }

    return { params: { ...listParams, cursor: decodedCursor } };
};

const escapeLikeWildcards = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

const createQueryParams = () => {
    const values: unknown[] = [];
    const addQueryParam: AddQueryParam = (value) => `$${values.push(value)}`;
    return { values, addQueryParam };
};

const buildSingleStatusEqualityOrAnyList = (statuses: string[], addQueryParam: AddQueryParam) =>
    statuses.length === 1
        ? `orders.status = ${addQueryParam(statuses[0])}`
        : `orders.status = ANY(${addQueryParam(statuses)}::text[])`;

const buildFilterConditions = (filters: OrderFilters & { statuses?: string[] }, addQueryParam: AddQueryParam) => {
    const conditions: string[] = [];

    if (filters.statuses?.length) {
        conditions.push(buildSingleStatusEqualityOrAnyList(filters.statuses, addQueryParam));
    }
    if (filters.priorities.length) {
        conditions.push(`orders.priority = ANY(${addQueryParam(filters.priorities)}::text[])`);
    }
    if (filters.searchTerm) {
        const orderIdMatch = ORDER_ID_SEARCH_PATTERN.exec(filters.searchTerm);
        if (orderIdMatch) {
            const orderId = Number(orderIdMatch[1]);
            conditions.push(orderId <= POSTGRES_INT_MAX ? `orders.id = ${addQueryParam(orderId)}` : 'FALSE');
        } else {
            conditions.push(`orders.customer ILIKE ${addQueryParam(`%${escapeLikeWildcards(filters.searchTerm)}%`)}`);
        }
    }
    if (filters.createdAtFrom) {
        conditions.push(`orders.created_at >= ${addQueryParam(filters.createdAtFrom)}::timestamptz`);
    }
    if (filters.createdAtTo) {
        conditions.push(`orders.created_at < ${addQueryParam(filters.createdAtTo)}::timestamptz`);
    }

    return conditions;
};

const buildWhereClause = (conditions: string[]) => (conditions.length ? `WHERE ${conditions.join(' AND ')}` : '');

export const buildOrderListQuery = (params: OrderListParams) => {
    const { values, addQueryParam } = createQueryParams();
    const conditions = buildFilterConditions(params, addQueryParam);
    const sqlDirection = params.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const afterCursorOperator = params.sortDirection === 'desc' ? '<' : '>';

    if (params.cursor?.sortField === 'createdAt') {
        conditions.push(
            `(orders.created_at, orders.id) ${afterCursorOperator} (${addQueryParam(params.cursor.lastCreatedAt)}::timestamptz, ${addQueryParam(params.cursor.lastId)}::int)`,
        );
    } else if (params.cursor) {
        conditions.push(`orders.id ${afterCursorOperator} ${addQueryParam(params.cursor.lastId)}::int`);
    }

    const orderByClause =
        params.sortField === 'createdAt'
            ? `ORDER BY orders.created_at ${sqlDirection}, orders.id ${sqlDirection}`
            : `ORDER BY orders.id ${sqlDirection}`;

    const limitWithLookaheadRow = params.limit + 1;

    const pageSubquery = `(
        SELECT * FROM orders
        ${buildWhereClause(conditions)}
        ${orderByClause}
        LIMIT ${addQueryParam(limitWithLookaheadRow)}
    )`;

    return { text: `${buildOrderQuery(pageSubquery, CURSOR_CREATED_AT_COLUMN)} ${orderByClause}`, values };
};

export const buildOrderSummaryQuery = (filters: OrderFilters) => {
    const { values, addQueryParam } = createQueryParams();
    const countPerStatus = ORDER_STATUSES.map((status) => {
        const statusParam = addQueryParam(status);
        return `${statusParam}::text, COUNT(*) FILTER (WHERE orders.status = ${statusParam})`;
    }).join(',\n                ');
    const text = `
        SELECT
            COUNT(*)::int AS total,
            JSON_BUILD_OBJECT(
                ${countPerStatus}
            ) AS "byStatus"
        FROM orders
        ${buildWhereClause(buildFilterConditions(filters, addQueryParam))}
    `;

    return { text, values };
};
