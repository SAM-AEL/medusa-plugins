import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getShiprocketManager, hasShiprocketCredentials } from "../../../../providers/shiprocket/client/manager"
import { rateLimiter, getClientIdentifier } from "./rate-limiter"
import { fail, ok } from "../../../../shared/http"

// Make this route public (no publishable API key required)
export const AUTHENTICATE = false

// Cache for pickup location pincode (long TTL - 1 hour)
let cachedPickupPincode: { value: string; expiresAt: number } | null = null

/**
 * GET /store/shiprocket/delivery-estimate
 * 
 * Check delivery serviceability and get estimated delivery dates for a pincode.
 * 
 * Features:
 * - Rate limited: 30 requests per minute per IP
 * - Uses singleton client manager with token caching (zero auth overhead)
 * 
 * Query parameters:
 * - delivery_pincode: The delivery destination pincode (required)
 * - pickup_pincode: The pickup location pincode (optional, auto-fetched from SHIPROCKET_PICKUP_LOCATION)
 * - weight: Package weight in kg (optional, defaults to 0.5)
 * - cod: Cash on delivery flag, 0 or 1 (optional, defaults to 0)
 */
export async function GET(
    req: MedusaRequest,
    res: MedusaResponse
) {
    // Rate limiting check
    const clientId = getClientIdentifier(req)
    if (!rateLimiter.isAllowed(clientId)) {
        const resetTime = rateLimiter.getResetTime(clientId)
        res.setHeader("X-RateLimit-Limit", "30")
        res.setHeader("X-RateLimit-Remaining", "0")
        res.setHeader("X-RateLimit-Reset", resetTime.toString())
        res.setHeader("Retry-After", resetTime.toString())
        return fail(res, 429, "RATE_LIMITED", `Rate limit exceeded. Try again in ${resetTime} seconds.`)
    }

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", "30")
    res.setHeader("X-RateLimit-Remaining", rateLimiter.getRemaining(clientId).toString())

    const { pickup_pincode, delivery_pincode, weight, cod } = req.query as {
        pickup_pincode?: string
        delivery_pincode?: string
        weight?: string
        cod?: string
    }

    // Validate credentials are configured
    if (!hasShiprocketCredentials()) {
        return fail(
            res,
            500,
            "CONFIGURATION_ERROR",
            "Shiprocket credentials not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD environment variables."
        )
    }

    // Validate delivery pincode is provided
    if (!delivery_pincode) {
        return fail(res, 400, "INVALID_QUERY", "'delivery_pincode' query parameter is required")
    }

    // Validate delivery pincode format (Indian pincodes are 6 digits)
    const pincodeRegex = /^\d{6}$/
    if (!pincodeRegex.test(delivery_pincode)) {
        return fail(res, 400, "INVALID_QUERY", "Delivery pincode must be a 6-digit number")
    }

    if (weight !== undefined && (isNaN(Number(weight)) || Number(weight) <= 0 || Number(weight) > 100)) {
        return fail(res, 400, "INVALID_QUERY", "weight must be a number between 0 and 100")
    }

    if (cod !== undefined && !["0", "1"].includes(String(cod))) {
        return fail(res, 400, "INVALID_QUERY", "cod must be 0 or 1")
    }

    const logger = req.scope.resolve("logger")

    try {
        // Get singleton client manager (reuses token and connection across requests)
        const manager = getShiprocketManager(logger)
        const pickupLocation = manager.getPickupLocation()

        // Determine pickup pincode
        let pickupPincode = pickup_pincode

        if (!pickupPincode) {
            // Check if we have a cached pickup pincode
            if (cachedPickupPincode && Date.now() < cachedPickupPincode.expiresAt) {
                pickupPincode = cachedPickupPincode.value
            } else if (pickupLocation) {
                // Fetch from Shiprocket using the manager (uses cached token)
                const fetchedPincode = await manager.getPickupPincode(pickupLocation)
                if (fetchedPincode) {
                    pickupPincode = fetchedPincode
                    // Cache for 1 hour
                    cachedPickupPincode = {
                        value: fetchedPincode,
                        expiresAt: Date.now() + 60 * 60 * 1000,
                    }
                }
            }
        }

        if (!pickupPincode) {
            return fail(
                res,
                400,
                "INVALID_QUERY",
                "Either provide 'pickup_pincode' or set SHIPROCKET_PICKUP_LOCATION to auto-fetch pickup pincode"
            )
        }

        // Validate pickup pincode format
        if (!pincodeRegex.test(pickupPincode)) {
            return fail(res, 400, "INVALID_QUERY", "Pickup pincode must be a 6-digit number")
        }

        // Get delivery estimate using manager (uses cached token and connection)
        const estimate = await manager.getDeliveryEstimate({
            pickup_postcode: pickupPincode,
            delivery_postcode: delivery_pincode,
            weight: weight ? parseFloat(weight) : undefined,
            cod: cod ? parseInt(cod) : undefined,
        })

        return ok(res, { estimate })
    } catch (error: any) {
        logger.error(`Delivery estimate error: ${error.message}`)
        return fail(res, 500, "DELIVERY_ESTIMATE_FAILED", error.message || "An unexpected error occurred")
    }
}
