import axios, { AxiosInstance } from "axios"
import { MedusaError } from "@medusajs/utils"
import { authenticate } from "./methods/authenticate"
import { handleError } from "./handle-error"
import { getShiprocketManager } from "./manager"
import { validateAndSanitizePhone, validateAndSanitizePincode, requireField } from "../utils/validation"
import { getLineItemDimensions } from "../utils/dimensions"
import { Logger } from "@medusajs/framework/types"

import type {
    ShiprocketClientOptions,
    ShiprocketCalculateRateRequest,
    ShiprocketCalculateRateResponse,
    ShiprocketCreateOrderResponse,
    ShiprocketTrackingResponse,
    ShiprocketDeliveryEstimateRequest,
    ShiprocketDeliveryEstimateResponse,
    ShiprocketPickupLocation,
    ShiprocketPickupLocationsResponse,
} from "./types"

const DEFAULT_TIMEOUT = 15000 // 15 seconds

export default class ShiprocketClient {
    private email: string
    private password: string
    private pickup_location?: string
    private axios: AxiosInstance
    private token: string | null = null
    private isDisposed = false
    private logger?: Logger

    constructor(options: ShiprocketClientOptions) {
        if (!options.email || !options.password) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Shiprocket API credentials are required"
            )
        }

        this.email = options.email
        this.password = options.password
        this.pickup_location = options.pickup_location
        this.logger = options.logger
        // We do not instantiate a new `axios` here. We will use the shared one from `manager.ts`
        // We keep this structure compatible with existing code but route requests through the manager.
    }

    dispose(): void {
        this.isDisposed = true
        // If we were holding onto anything else, we'd dispose it here
    }

    private async getSharedAxios(): Promise<AxiosInstance> {
        if (this.isDisposed) {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ShiprocketClient is disposed")
        }
        const manager = getShiprocketManager()
        return await manager.getAxios()
    }

    /**
     * Get all pickup locations with their pincodes
     * @param locationName Optional - filter by location name/nickname
     */
    async getPickupLocations(locationName?: string): Promise<ShiprocketPickupLocation[]> {
        try {
            const response = await (await this.getSharedAxios()).get<ShiprocketPickupLocationsResponse>(
                "/settings/company/pickup"
            )

            const locations = response.data.data.shipping_address || []

            // Filter by location name if provided
            if (locationName) {
                return locations.filter(
                    (loc) => loc.pickup_location.toLowerCase() === locationName.toLowerCase()
                )
            }

            return locations
        } catch (error: any) {
            handleError(error, { operation: "getPickupLocations" })
            return []
        }
    }

    /**
     * Get pincode for a pickup location by name
     */
    async getPickupPincode(locationName: string): Promise<string | null> {
        const locations = await this.getPickupLocations(locationName)
        return locations[0]?.pin_code || null
    }

    private rateCache = new Map<string, { rate: number; timestamp: number }>()
    private CACHE_TTL = 1000 * 60 * 30 // 30 minutes

    /**
     * Calculate shipping rate for a route
     */
    async calculate(data: ShiprocketCalculateRateRequest): Promise<number> {
        // Simple in-memory cache to avoid redundant slow API calls
        const cacheKey = [
            data.pickup_postcode,
            data.delivery_postcode,
            data.weight,
            data.cod
        ].join("-")

        const cached = this.rateCache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            this.logger?.debug(`Shiprocket: Using cached rate for ${cacheKey}: ${cached.rate}`)
            return cached.rate
        }

        try {
            const response = await (await this.getSharedAxios()).get<ShiprocketCalculateRateResponse>(
                "/courier/serviceability/",
                { params: data }
            )

            const availableCouriers = response.data.data.available_courier_companies
            if (!availableCouriers?.length) {
                throw new MedusaError(
                    MedusaError.Types.NOT_FOUND,
                    `No couriers available for route ${data.pickup_postcode} -> ${data.delivery_postcode}`
                )
            }

            // Filter by allowed courier IDs if specified
            const filtered = data.allowed_courier_ids?.length
                ? availableCouriers.filter((c) => data.allowed_courier_ids!.includes(c.id))
                : availableCouriers

            if (!filtered?.length) {
                throw new MedusaError(
                    MedusaError.Types.NOT_FOUND,
                    "No allowed couriers available for this route"
                )
            }

            // Return cheapest rate
            const cheapest = filtered.reduce((min, curr) =>
                Number(curr.rate) < Number(min.rate) ? curr : min
            )

            const rate = Math.ceil(Number(cheapest?.rate) || 0)

            // Update cache
            this.rateCache.set(cacheKey, { rate, timestamp: Date.now() })

            return rate
        } catch (error: any) {
            if (error instanceof MedusaError) throw error
            handleError(error, { operation: "calculate" })
        }
    }

    /**
     * Get delivery estimate for a route - returns raw Shiprocket API response
     */
    async getDeliveryEstimate(data: ShiprocketDeliveryEstimateRequest): Promise<any> {
        try {
            const response = await (await this.getSharedAxios()).get(
                "/courier/serviceability/",
                {
                    params: {
                        pickup_postcode: data.pickup_postcode,
                        delivery_postcode: data.delivery_postcode,
                        weight: data.weight || 0.5,
                        cod: data.cod || 0,
                    }
                }
            )

            return response.data
        } catch (error: any) {
            if (error instanceof MedusaError) throw error
            if (error?.response?.status === 404) {
                return {
                    status: 404,
                    data: { available_courier_companies: [] }
                }
            }
            handleError(error, { operation: "getDeliveryEstimate" })
        }
    }

    /**
     * Create an order in Shiprocket and assign AWB
     */
    async create(
        fulfillment: any,
        items: any[],
        order: any
    ): Promise<ShiprocketCreateOrderResponse> {
        // Map order items by ID for quick lookup
        const orderItemMap = new Map()
        if (Array.isArray(order.items)) {
            order.items.forEach((orderItem: any) => {
                orderItemMap.set(orderItem.id, orderItem)
            })
        }

        let totalWeight = 0
        let totalLength = 0
        let totalBreadth = 0
        let totalHeight = 0

        try {
            // Email lives on the customer object in FulfillmentOrderDTO — not at the order level
            const customerEmail = order?.customer?.email

            // strict YYYY-MM-DD HH:mm for shiprocket
            const d = new Date(order.created_at)
            const pad = (n: number) => n.toString().padStart(2, "0")
            const orderDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

            // Calculate totals and dimensions
            for (const item of items) {
                const orderItem = orderItemMap.get(item.line_item_id)
                if (!orderItem) {
                    throw new MedusaError(
                        MedusaError.Types.INVALID_DATA,
                        `Order item not found for fulfillment item: ${item.title}`
                    )
                }

                const variant = orderItem.variant
                if (!variant) {
                    throw new MedusaError(
                        MedusaError.Types.INVALID_DATA,
                        `Variant data missing for item: ${item.title}`
                    )
                }

                const product = (variant as any).product

                const { weightKg: weight, length, width: breadth, height } = getLineItemDimensions(variant);

                // Strict Validation: Shiprocket fines for incorrect dimensions
                if (!weight || !length || !breadth || !height) {
                    throw new MedusaError(
                        MedusaError.Types.INVALID_DATA,
                        `Missing dimensions/weight for "${item.title}". Please set them on the Variant or Product.`
                    )
                }

                const quantity = Number(item.quantity || item.raw_quantity?.value || 1)
                totalWeight += weight * quantity
                totalLength = Math.max(totalLength, length)
                totalBreadth = Math.max(totalBreadth, breadth)
                totalHeight += height * quantity
            }

            const shipping = order.shipping_address || fulfillment?.delivery_address || {}
            // billing_address is not included in FulfillmentOrderDTO — fall back to shipping
            const billing = (order.billing_address && Object.keys(order.billing_address).length > 0)
                ? order.billing_address
                : shipping
            const shippingIsBilling = !order.billing_address || (
                shipping.address_1 === billing.address_1 &&
                shipping.postal_code === billing.postal_code
            )

            // Build order payload
            const orderData = {
                order_id: `${order.id}-${Math.floor(Date.now() / 1000)}`,
                order_date: orderDate,
                pickup_location: this.pickup_location || "Primary",

                billing_customer_name: requireField(billing.first_name || shipping.first_name, "Billing First Name"),
                billing_last_name: billing.last_name || shipping.last_name || "",
                billing_address: requireField(billing.address_1 || shipping.address_1, "Billing Address"),
                billing_address_2: billing.address_2 || shipping.address_2 || "",
                billing_city: requireField(billing.city || shipping.city, "Billing City"),
                billing_pincode: validateAndSanitizePincode(requireField(billing.postal_code || shipping.postal_code, "Billing Pincode"), "Billing Pincode"),
                billing_state: requireField(billing.province || shipping.province, "Billing State"),
                billing_country: requireField(billing.country_code || shipping.country_code || "IN", "Billing Country"),
                billing_email: requireField(customerEmail, "Billing Email"),
                billing_phone: validateAndSanitizePhone(requireField(billing.phone || shipping.phone, "Billing Phone"), "Billing Phone"),

                shipping_is_billing: shippingIsBilling,
                shipping_customer_name: requireField(shipping.first_name, "Shipping First Name"),
                shipping_last_name: shipping.last_name || "",
                shipping_address: requireField(shipping.address_1, "Shipping Address"),
                shipping_address_2: shipping.address_2 || "",
                shipping_city: requireField(shipping.city, "Shipping City"),
                shipping_pincode: validateAndSanitizePincode(requireField(shipping.postal_code, "Shipping Pincode"), "Shipping Pincode"),
                shipping_country: requireField(shipping.country_code || "IN", "Shipping Country"),
                shipping_state: requireField(shipping.province, "Shipping State"),
                shipping_email: requireField(customerEmail, "Shipping Email"),
                shipping_phone: validateAndSanitizePhone(requireField(shipping.phone, "Shipping Phone"), "Shipping Phone"),

                order_items: items.map((item) => {
                    const orderItem = orderItemMap.get(item.line_item_id)!
                    const variant = orderItem.variant!
                    const selling_price = Math.round(Number(orderItem.unit_price || orderItem.detail?.unit_price || 0))

                    return {
                        name: item.title,
                        sku: variant.sku || orderItem.variant_sku || item.sku || item.id,
                        units: Number(item.quantity || item.raw_quantity?.value || 1),
                        selling_price,
                        discount: "",
                        tax: "",
                        hsn: Number(variant.hs_code || 0),
                    }
                }),

                payment_method: (order.payment_status === "awaiting" || order.payment_status === "not_paid" || order.payment_status === "requires_action") ? "COD" : "Prepaid",
                sub_total: items.reduce((sum, item) => {
                    const orderItem = orderItemMap.get(item.line_item_id)!
                    const priceMinor = Number(orderItem.unit_price || (orderItem as any).detail?.unit_price || 0)
                    const qty = Number(item.quantity || (item as any).raw_quantity?.value || 1)
                    // unit_price is integer minor units; sub_total is major units for Shiprocket
                    return sum + (Math.round(priceMinor) / 100 * qty)
                }, 0),
                length: totalLength,
                breadth: totalBreadth,
                height: totalHeight,
                weight: totalWeight,
            }

            // Create order
            const orderCreated = await (await this.getSharedAxios())
                .post<ShiprocketCreateOrderResponse>("/orders/create/adhoc", orderData)
                .catch((err) => {
                    const apiError = err?.response?.data?.errors
                    if (apiError) {
                        const firstError = Object.values(apiError)[0]
                        const msg = Array.isArray(firstError) ? firstError[0] : firstError
                        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Shiprocket: ${msg}`)
                    }
                    throw err
                })

            if (!orderCreated.data?.shipment_id) {
                throw new MedusaError(
                    MedusaError.Types.INVALID_DATA,
                    "Shiprocket order created but no shipment ID returned"
                )
            }

            // Try to get preferred courier based on SHIPROCKET_DELIVERY_PREFERENCE env.
            // Pickup pincode MUST be the warehouse location, not the customer address.
            let courierId: number | null = null
            try {
                const manager = getShiprocketManager()
                const deliveryPincode = shipping.postal_code || (shipping as any).zip
                let pickupPincode: string | null =
                    process.env.SHIPROCKET_PICKUP_PINCODE || null
                if (!pickupPincode) {
                    pickupPincode = await this.getPickupPincode(this.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || "Primary").catch(() => null)
                }
                if (pickupPincode && deliveryPincode) {
                    courierId = await manager.getPreferredCourier({
                        pickup_postcode: pickupPincode,
                        delivery_postcode: deliveryPincode,
                        weight: totalWeight,
                        cod: (order.payment_status === 'awaiting' || order.payment_status === 'not_paid') ? 1 : 0,
                    })
                }
            } catch {
                // Fallback to auto-assign if courier selection fails
            }

            // Assign AWB with optional courier_id
            const awbPayload: any = { shipment_id: orderCreated.data.shipment_id }
            if (courierId) {
                awbPayload.courier_id = courierId
            }
            const awbCreated = await (await this.getSharedAxios()).post("/courier/assign/awb", awbPayload)

            if (awbCreated.data.awb_assign_status !== 1) {
                // Cancel order to avoid stuck state
                try { await this.cancel(orderCreated.data.order_id) } catch { /* ignore */ }

                throw new MedusaError(
                    MedusaError.Types.NOT_ALLOWED,
                    awbCreated.data.message || "AWB assignment failed - no courier available"
                )
            }

            const responseData = awbCreated.data.response.data

            // Try to schedule pickup automatically for today
            if (orderCreated.data.shipment_id) {
                // Background task, don't wait or fail the fulfillment if this fails
                this.schedulePickup(orderCreated.data.shipment_id).catch(() => {})
            }

            return {
                ...orderCreated.data,
                awb: responseData.awb_code,
                courier_company_id: responseData.courier_company_id,
                courier_name: responseData.courier_name || orderCreated.data.courier_name,
                tracking_number: responseData.awb_code,
                tracking_url: `https://shiprocket.co/tracking/${responseData.awb_code}`,
            }

        } catch (error: any) {
            if (error instanceof MedusaError) throw error
            handleError(error, { operation: "create", orderId: order?.id })
        }
    }

    /**
     * Cancel an order in Shiprocket
     */
    async cancel(orderId: string): Promise<void> {
        try {
            await (await this.getSharedAxios()).post("/orders/cancel", { ids: [orderId] })
        } catch (error: any) {
            // Check if the order is already cancelled using specific status code / message
            const apiError = error?.response?.data
            const messageStr = typeof apiError === "string"
                ? apiError.toLowerCase()
                : JSON.stringify(apiError ?? "")?.toLowerCase() ?? ""

            if (messageStr.includes("already cancelled") || messageStr.includes("already canceled") || (error?.response?.status === 400 && messageStr.includes("cannot cancel"))) {
                this.logger?.info(`[Shiprocket] Order ${orderId} is already cancelled/cannot be cancelled. Skipping error.`)
                return // Idempotent success
            }

            handleError(error, { operation: "cancel", orderId })
        }
    }

    /**
     * Schedule pickup for a shipment
     */
    async schedulePickup(shipmentId: number | string, date?: Date): Promise<boolean> {
        try {
            const pickupDate = date || new Date()

            // Shiprocket operates on IST: format the pickup date in Asia/Kolkata,
            // otherwise an evening-IST fulfillment formats as "yesterday" in UTC.
            const istParts = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Kolkata",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).format(pickupDate)
            // en-CA yields YYYY-MM-DD
            const dStr = istParts
            const numericShipmentId = Number(shipmentId)
            if (!Number.isFinite(numericShipmentId)) {
                this.logger?.warn(`Shiprocket: invalid shipment_id for pickup: ${String(shipmentId)}`)
                return false
            }

            await (await this.getSharedAxios()).post("/courier/generate/pickup", {
                shipment_id: [numericShipmentId],
                pickup_date: [dStr]
            })
            
            this.logger?.info(`Shiprocket: Successfully scheduled pickup for shipment ${shipmentId}`)
            return true
        } catch (error: any) {
            // We only log warning instead of failing the fulfillment because the AWB is already assigned
            this.logger?.warn(`Shiprocket: Failed to schedule pickup for shipment ${shipmentId}. You may need to schedule it manually in the Shiprocket dashboard. Error: ${error?.response?.data?.message || error.message}`)
            return false
        }
    }

    /**
     * Get tracking information for a shipment
     */
    async getTrackingInfo(trackingNumber: string): Promise<ShiprocketTrackingResponse> {
        try {
            const response = await (await this.getSharedAxios()).get<ShiprocketTrackingResponse>(
                // encodeURIComponent so an unexpected value cannot alter the path.
                `/courier/track/awb/${encodeURIComponent(trackingNumber)}`
            )
            return response.data
        } catch (error: any) {
            handleError(error, { operation: "tracking" })
        }
    }

    /**
     * Create a return order in Shiprocket
     */
    async createReturn(fulfillment: any): Promise<ShiprocketCreateOrderResponse> {
        const returnData = {
            order_id: `${fulfillment.id}-${Math.floor(Date.now() / 1000)}`,
            order_date: new Date().toISOString().split("T")[0],
            
            // Pickup details (Customer returning the item)
            pickup_customer_name: requireField(fulfillment.pickup_address?.first_name || "Customer", "Pickup Customer Name"),
            pickup_last_name: fulfillment.pickup_address?.last_name || "",
            pickup_address: requireField(fulfillment.pickup_address?.address_1, "Pickup Address"),
            pickup_address_2: fulfillment.pickup_address?.address_2 || "",
            pickup_city: requireField(fulfillment.pickup_address?.city, "Pickup City"),
            pickup_state: requireField(fulfillment.pickup_address?.province, "Pickup State"),
            pickup_country: fulfillment.pickup_address?.country_code || "India",
            pickup_pincode: validateAndSanitizePincode(requireField(fulfillment.pickup_address?.postal_code, "Pickup Pincode"), "Pickup Pincode"),
            pickup_email: fulfillment.email || "customer@example.com",
            pickup_phone: validateAndSanitizePhone(requireField(fulfillment.pickup_address?.phone, "Pickup Phone"), "Pickup Phone"),
            
            // Shipping details (Warehouse receiving the returned item)
            shipping_customer_name: fulfillment.shipping_address?.first_name || fulfillment.shipping_address?.company || "Warehouse",
            shipping_last_name: fulfillment.shipping_address?.last_name || "",
            shipping_address: requireField(fulfillment.shipping_address?.address_1, "Shipping Address"),
            shipping_address_2: fulfillment.shipping_address?.address_2 || "",
            shipping_city: requireField(fulfillment.shipping_address?.city, "Shipping City"),
            shipping_state: requireField(fulfillment.shipping_address?.province, "Shipping State"),
            shipping_country: fulfillment.shipping_address?.country_code || "India",
            shipping_pincode: validateAndSanitizePincode(requireField(fulfillment.shipping_address?.postal_code, "Shipping Pincode"), "Shipping Pincode"),
            shipping_email: fulfillment.shipping_address?.email || "warehouse@example.com",
            shipping_phone: validateAndSanitizePhone(requireField(fulfillment.shipping_address?.phone, "Shipping Phone"), "Shipping Phone"),

            order_items: fulfillment.items?.map((item: any) => ({
                name: item.title,
                sku: item.sku || "RETURN-ITEM",
                units: item.quantity,
                selling_price: Math.round(Number(item.unit_price || 0)),
                discount: "",
                qc_enable: false,
            })) || [],
            payment_method: "Prepaid",
            total_discount: "0",
            sub_total: Math.round(Number(fulfillment.sub_total || 0)),
            length: fulfillment.length || 10,
            breadth: fulfillment.breadth || 10,
            height: fulfillment.height || 10,
            weight: fulfillment.weight || 0.5,
        }

        try {
            const response = await (await this.getSharedAxios()).post("/orders/create/return", returnData)
            return response.data
        } catch (error: any) {
            handleError(error, { operation: "createReturn" })
        }
    }

    /**
     * Generate documents (manifest, label, invoice) for a shipment
     */
    async createDocuments(fulfillment: any): Promise<{
        manifest: string
        label: string
        invoice: string
    }> {
        // Shiprocket tolerates a document failing to generate (e.g. an AWB not yet
        // assigned), so these calls stay non-fatal. But the failure must be
        // visible: previously only console.error fired, so a fulfilment could
        // silently end up with no label. Log through the module logger with a
        // status code only — never the raw response body, which can echo the
        // request payload containing customer PII.
        const safePost = async (url: string, data: any) =>
            (await this.getSharedAxios()).post(url, data).catch((err: any) => {
                const status = err?.response?.status ?? "network"
                this.logger?.warn?.(
                    `Shiprocket document generation failed at ${url} (${status}); ` +
                    `continuing without that document.`
                )
                return { data: null }
            })

        // Shiprocket expects arrays for IDs even if it's just one.
        // NOTE: manifests are generated per Shiprocket order_id, labels per shipment_id.
        const [manifestRes, labelRes, invoiceRes] = await Promise.all([
            safePost("/manifests/generate", { order_ids: [fulfillment.order_id] }),
            safePost("/courier/generate/label", { shipment_id: [fulfillment.shipment_id] }),
            safePost("/orders/print/invoice", { ids: [fulfillment.order_id] }),
        ])

        const extractUrl = (res: any, key: string, checkKey?: string, checkVal?: any) => {
            if (!res?.data) return ""
            const item = Array.isArray(res.data) ? res.data[0] : res.data

            // Handle cases where Shiprocket returns { status: 1, manifest_url: "..." }
            const data = res.data?.data || res.data
            const target = Array.isArray(data) ? data[0] : data

            if (!target) return ""
            if (checkKey && target[checkKey] !== checkVal) return ""
            return target[key] || ""
        }

        return {
            manifest: extractUrl(manifestRes, "manifest_url", "status", 1),
            label: extractUrl(labelRes, "label_url", "label_created", 1),
            invoice: extractUrl(invoiceRes, "invoice_url", "is_invoice_created", true),
        }
    }

    /**
     * Generate label for a shipment
     */
    async generateLabel(fulfillment: any): Promise<string> {
        try {
            const res = await (await this.getSharedAxios()).post("/courier/generate/label", {
                shipment_id: [fulfillment.shipment_id],
            })
            const data = res.data?.data || res.data
            const item = Array.isArray(data) ? data[0] : data
            return item?.label_url || ""
        } catch {
            return ""
        }
    }

    /**
     * Generate invoice for an order
     */
    async generateInvoice(fulfillment: any): Promise<string> {
        try {
            const res = await (await this.getSharedAxios()).post("/orders/print/invoice", {
                ids: [fulfillment.order_id],
            })
            const data = res.data?.data || res.data
            const item = Array.isArray(data) ? data[0] : data
            return item?.invoice_url || ""
        } catch {
            return ""
        }
    }
}
