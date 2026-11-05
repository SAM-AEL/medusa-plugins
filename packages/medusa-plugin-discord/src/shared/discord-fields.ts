const prefixPaths = (prefix: string, paths: string[]) => paths.map((path) => `${prefix}.${path}`);
const unique = (paths: string[]) => Array.from(new Set(paths));

export const DISCORD_EVENTS = [
    "order.placed",
    "order.completed",
    "order.canceled",
    "order.updated",
    "order.fulfillment_created",
    "fulfillment.created",
    "fulfillment.shipment_created",
    "shipment.created",
    "customer.created",
    "customer.updated",
    "payment.captured",
    "payment.refunded",
] as const

export const SUPPORTED_DISCORD_EVENTS = DISCORD_EVENTS
export const DISCORD_SUBSCRIBER_CONFIG = { event: [...SUPPORTED_DISCORD_EVENTS] }

export function isSupportedDiscordEvent(value: unknown): value is (typeof DISCORD_EVENTS)[number] {
    return typeof value === "string" && (DISCORD_EVENTS as readonly string[]).includes(value)
}

export const DISCORD_EVENT_LABELS: Record<(typeof DISCORD_EVENTS)[number], string> = {
    "order.placed": "Order Placed",
    "order.completed": "Order Completed",
    "order.canceled": "Order Canceled",
    "order.updated": "Order Updated",
    "order.fulfillment_created": "Fulfillment Created",
    "fulfillment.created": "Fulfillment Created",
    "fulfillment.shipment_created": "Shipment Created",
    "shipment.created": "Shipment Created",
    "customer.created": "Customer Created",
    "customer.updated": "Customer Updated",
    "payment.captured": "Payment Captured",
    "payment.refunded": "Payment Refunded",
}

const WEBHOOK_RE =
    /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/
const WEBHOOK_RE_LEGACY =
    /^https:\/\/discordapp\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/

export function normalizeWebhookUrl(url: string): string {
    return (url || "").trim().replace(/\/+$/, "")
}

export function isValidWebhookUrl(url: string): boolean {
    const normalized = normalizeWebhookUrl(url)
    if (!normalized || normalized.length > 500) {
        return false
    }
    return WEBHOOK_RE.test(normalized) || WEBHOOK_RE_LEGACY.test(normalized)
}

/** Medusa money fields are integer minor units; Discord display needs major units. */
export function toMajorUnits(minor: number): number {
    if (!Number.isFinite(minor)) return 0;
    return minor / 100;
}

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
export function getCurrencyFormatter(currencyCode: unknown): Intl.NumberFormat {
    const raw = typeof currencyCode === "string" && currencyCode.trim() ? currencyCode.trim().toUpperCase() : "USD";
    const cached = currencyFormatterCache.get(raw);
    if (cached) return cached;
    let formatter: Intl.NumberFormat;
    try {
        formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: raw });
    } catch {
        formatter = new Intl.NumberFormat("en-US");
    }
    currencyFormatterCache.set(raw, formatter);
    return formatter;
}

/**
 * Escape Discord markdown + neutralize @everyone/@here pings from user-controlled data.
 *
 * This is the single canonical implementation used across the plugin. A
 * near-duplicate used to live in the subscriber with a narrower escape set,
 * which risked the two drifting apart.
 *
 * `>`, `|` and `#` are escaped because they enable block quotes, tables and
 * headings that could be used to disguise content. `:` and `-` are
 * deliberately left alone so that URLs and dates still render correctly.
 */
export function discordEscape(value: unknown): string {
    const str = value === undefined || value === null ? "" : String(value);
    return str
        .replace(/@(everyone|here)/gi, "@\u200b$1")
        .replace(/([*_`~|>#\[\]()])/g, "\\$1")
        .slice(0, 1000);
}

export const ORDER_FIELDS = [
    "id",
    "display_id",
    "status",
    "total",
    "subtotal",
    "currency_code",
    "email",
    "shipping_address.first_name",
    "shipping_address.last_name",
    "shipping_address.phone",
    "shipping_address.city",
    "billing_address.first_name",
    "billing_address.last_name",
    "billing_address.phone",
    "customer.first_name",
    "customer.last_name",
    "customer.email",
    "customer.phone",
    "payment_status",
    "fulfillment_status",
    "shipment_status",
    "tracking_numbers",
    "tracking_links",
];

export const CUSTOMER_FIELDS = [
    "id",
    "email",
    "first_name",
    "last_name",
    "phone",
];

export const FULFILLMENT_FIELDS = [
    "id",
    "tracking_numbers",
    "provider_id",
];

export const RETURN_FIELDS = [
    "id",
    "status",
    "order_id",
];

export function getSuggestedDataPathsForEvent(eventName: string): string[] {
    if (eventName.startsWith("order."))
        return ORDER_FIELDS;
    if (eventName.startsWith("customer."))
        return CUSTOMER_FIELDS;
    if (eventName.startsWith("fulfillment.")) {
        return unique([
            ...FULFILLMENT_FIELDS,
            ...prefixPaths("order", ORDER_FIELDS),
        ]);
    }
    if (eventName.startsWith("return.")) {
        return unique([
            ...RETURN_FIELDS,
            ...prefixPaths("order", ORDER_FIELDS),
        ]);
    }
    if (eventName.startsWith("claim.") || eventName.startsWith("exchange.")) {
        return unique([
            "id",
            "type",
            "order_id",
            ...prefixPaths("order", ORDER_FIELDS),
        ]);
    }
    return ORDER_FIELDS;
}
