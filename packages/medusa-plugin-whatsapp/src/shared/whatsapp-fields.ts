const prefixPaths = (prefix: string, paths: string[]) => paths.map((path) => `${prefix}.${path}`)

const unique = (paths: string[]) => Array.from(new Set(paths))

export const WHATSAPP_EVENTS = [
    "order.placed",
    "order.completed",
    "order.canceled",
    "order.updated",
    "order.fulfillment_created",
    "fulfillment.created",
    "fulfillment.shipment_created",
    "fulfillment.delivery_created",
    "customer.created",
    "customer.updated",
    "return.created",
    "return.received",
    "claim.created",
    "exchange.created",
]

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
]

export const CUSTOMER_FIELDS = [
    "id",
    "email",
    "first_name",
    "last_name",
    "phone",
]

export const FULFILLMENT_FIELDS = [
    "id",
    "tracking_numbers",
    "provider_id",
]

export const RETURN_FIELDS = [
    "id",
    "status",
    "order_id",
]

export function getSuggestedDataPathsForEvent(eventName: string) {
    if (eventName.startsWith("order.")) return ORDER_FIELDS
    if (eventName.startsWith("customer.")) return CUSTOMER_FIELDS
    if (eventName.startsWith("fulfillment.")) {
        return unique([
            ...FULFILLMENT_FIELDS,
            ...prefixPaths("order", ORDER_FIELDS),
        ])
    }
    if (eventName.startsWith("return.")) {
        return unique([
            ...RETURN_FIELDS,
            ...prefixPaths("order", ORDER_FIELDS),
        ])
    }
    if (eventName.startsWith("claim.") || eventName.startsWith("exchange.")) {
        return unique([
            "id",
            "type",
            "order_id",
            ...prefixPaths("order", ORDER_FIELDS),
        ])
    }

    return ORDER_FIELDS
}
