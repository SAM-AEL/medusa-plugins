import axios, { AxiosInstance } from "axios"
import http from "http"
import https from "https"
import { MedusaError } from "@medusajs/utils"
import { Logger } from "@medusajs/framework/types"
import { SHIPROCKET_DEFAULT_TIMEOUT_MS } from "./config"

interface CachedToken {
    token: string
    expiresAt: number
}

interface CachedDeliveryEstimate {
    response: any
    expiresAt: number
}

type DeliveryPreference = "FAST" | "CHEAP"

// Fallback logger for when Medusa logger is not available
const fallbackLogger: Logger = {
    debug: (msg: string) => { console.debug(`[Shiprocket] ${msg}`) },
    info: (msg: string) => { console.info(`[Shiprocket] ${msg}`) },
    warn: (msg: string) => { console.warn(`[Shiprocket] ${msg}`) },
    error: (msg: string) => { console.error(`[Shiprocket] ${msg}`) },
    silly: (msg: string) => { console.debug(`[Shiprocket] ${msg}`) },
    verbose: (msg: string) => { console.debug(`[Shiprocket] ${msg}`) },
    http: (msg: string) => { console.debug(`[Shiprocket] ${msg}`) },
    activity: (msg: string) => { console.log(`[Shiprocket] ${msg}`); return msg },
    progress: (activityId: string, msg: string) => { console.log(`[Shiprocket] [${activityId}] ${msg}`); return {} },
    failure: (activityId: string, msg: string) => { console.error(`[Shiprocket] [${activityId}] ${msg}`); return {} },
    success: (activityId: string, msg: string) => { console.log(`[Shiprocket] [${activityId}] ${msg}`); return {} },
    log: (...args: any[]) => { console.log("[Shiprocket]", ...args) },
    panic: (msg: Error) => { console.error(`[Shiprocket] PANIC:`, msg); throw msg },
    shouldLog: () => true,
    setLogLevel: () => { },
    unsetLogLevel: () => { },
}

const TOKEN_REFRESH_BUFFER_DAYS = 8 // Refresh 2 days before expiry (10 day token)
const DELIVERY_ESTIMATE_CACHE_HOURS = 4 // Cache estimates for 4 hours

/**
 * Singleton manager for Shiprocket API client.
 * 
 * Key features:
 * - Caches authentication token (valid for 10 days, refreshes at 8 days)
 * - Uses HTTP keep-alive for connection reuse
 * - Thread-safe token refresh with mutex pattern
 * - Shared axios instance across all requests
 */
class ShiprocketClientManager {
    private static instance: ShiprocketClientManager | null = null

    private cachedToken: CachedToken | null = null
    private tokenRefreshPromise: Promise<void> | null = null
    private axios: AxiosInstance
    private logger: Logger

    // Delivery estimate cache: key = "pickup-delivery-weight-cod"
    private deliveryEstimateCache: Map<string, CachedDeliveryEstimate> = new Map()
    private readonly maxCacheSize = 1000 // LRU cache limit

    private readonly email: string
    private readonly password: string
    private readonly pickupLocation?: string
    private readonly deliveryPreference: DeliveryPreference

    /**
     * Get the singleton instance of ShiprocketClientManager.
     * Lazily initializes on first call.
     */
    static getInstance(logger?: Logger): ShiprocketClientManager {
        if (!this.instance) {
            this.instance = new ShiprocketClientManager(logger)
        }
        return this.instance
    }

    /**
     * Check if credentials are configured.
     */
    static hasCredentials(): boolean {
        return !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD)
    }

    /**
     * Reset the singleton (useful for testing).
     */
    static reset(): void {
        if (this.instance) {
            this.instance.cachedToken = null
            this.instance.tokenRefreshPromise = null
        }
        this.instance = null
    }

    private constructor(logger?: Logger) {
        this.email = process.env.SHIPROCKET_EMAIL || ""
        this.password = process.env.SHIPROCKET_PASSWORD || ""
        this.pickupLocation = process.env.SHIPROCKET_PICKUP_LOCATION
        this.deliveryPreference = (process.env.SHIPROCKET_DELIVERY_PREFERENCE?.toUpperCase() as DeliveryPreference) || "FAST"
        this.logger = logger || fallbackLogger

        if (!this.email || !this.password) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Shiprocket credentials (SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD) not configured"
            )
        }

        // Create axios instance with keep-alive for connection reuse
        const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })
        const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })

        this.axios = axios.create({
            baseURL: "https://apiv2.shiprocket.in/v1/external",
            headers: { "Content-Type": "application/json" },
            timeout: SHIPROCKET_DEFAULT_TIMEOUT_MS,
            httpAgent,
            httpsAgent,
        })

        // Interceptor to handle 401 Unauthorized - auto-refresh token
        this.axios.interceptors.response.use(
            (response) => response,
            async (error) => {
                const originalRequest = error.config
                if (
                    error.response?.status === 401 &&
                    !originalRequest._retry &&
                    !originalRequest.url?.includes("/auth/login")
                ) {
                    originalRequest._retry = true
                    try {
                        await this.refreshToken()
                        originalRequest.headers["Authorization"] = `Bearer ${this.cachedToken!.token}`
                        return this.axios(originalRequest)
                    } catch (refreshError) {
                        return Promise.reject(refreshError)
                    }
                }
                return Promise.reject(error)
            }
        )

        this.logger.info("ShiprocketClientManager initialized with HTTP keep-alive")
    }

    /**
     * Get the shared axios instance with valid authentication.
     * Automatically refreshes token if expired or about to expire.
     */
    async getAxios(): Promise<AxiosInstance> {
        await this.ensureToken()
        return this.axios
    }

    /**
     * Get the current token (for debugging/logging).
     */
    getTokenExpiry(): Date | null {
        return this.cachedToken ? new Date(this.cachedToken.expiresAt) : null
    }

    /**
     * Get pickup location from environment.
     */
    getPickupLocation(): string | undefined {
        return this.pickupLocation
    }

    /**
     * Get delivery preference from environment (FAST or CHEAP).
     */
    getDeliveryPreference(): DeliveryPreference {
        return this.deliveryPreference
    }

    /**
     * Force a token refresh (e.g., for scheduled job).
     */
    async forceRefreshToken(): Promise<void> {
        await this.refreshToken()
        this.logger.info("Shiprocket token force-refreshed")
    }

    /**
     * Check if token is valid and not about to expire.
     */
    isTokenValid(): boolean {
        if (!this.cachedToken) return false
        // Add 1 minute buffer for safety
        return Date.now() < this.cachedToken.expiresAt - 60000
    }

    /**
     * Ensure we have a valid token, refreshing if needed.
     * Uses mutex pattern to prevent concurrent refresh requests.
     */
    private async ensureToken(): Promise<void> {
        if (this.isTokenValid()) {
            return
        }

        // If another refresh is in progress, wait for it
        if (this.tokenRefreshPromise) {
            await this.tokenRefreshPromise
            return
        }

        await this.refreshToken()
    }

    /**
     * Refresh the authentication token.
     * Thread-safe - prevents concurrent refresh requests.
     */
    private async refreshToken(): Promise<void> {
        // Mutex pattern: only one refresh at a time
        if (this.tokenRefreshPromise) {
            await this.tokenRefreshPromise
            return
        }

        this.tokenRefreshPromise = this.doRefreshToken()

        try {
            await this.tokenRefreshPromise
        } finally {
            this.tokenRefreshPromise = null
        }
    }

    private async doRefreshToken(): Promise<void> {
        this.logger.debug("Refreshing Shiprocket token...")

        try {
            const response = await this.axios.post<{ token: string }>("/auth/login", {
                email: this.email,
                password: this.password,
            })

            if (!response.data?.token) {
                throw new MedusaError(
                    MedusaError.Types.INVALID_DATA,
                    "Shiprocket authentication failed: no token received"
                )
            }

            // Token valid for 10 days, refresh at 8 days
            this.cachedToken = {
                token: response.data.token,
                expiresAt: Date.now() + TOKEN_REFRESH_BUFFER_DAYS * 24 * 60 * 60 * 1000,
            }

            this.axios.defaults.headers.common["Authorization"] = `Bearer ${this.cachedToken.token}`

            this.logger.info(
                `Shiprocket token refreshed, expires at ${new Date(this.cachedToken.expiresAt).toISOString()}`
            )
        } catch (error: any) {
            this.logger.error(`Shiprocket authentication failed: ${error.message}`)

            if (error instanceof MedusaError) throw error

            const apiError = error?.response?.data
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                apiError?.message || "Shiprocket authentication failed"
            )
        }
    }

    // ============================================
    // API Methods - Use these instead of creating clients
    // ============================================

    /**
     * Get pickup locations from Shiprocket.
     */
    async getPickupLocations(locationName?: string): Promise<any[]> {
        await this.ensureToken()

        try {
            const response = await this.axios.get<{ data: { shipping_address: any[] } }>(
                "/settings/company/pickup"
            )

            const locations = response.data.data.shipping_address || []

            if (locationName) {
                return locations.filter(
                    (loc: any) => loc.pickup_location.toLowerCase() === locationName.toLowerCase()
                )
            }

            return locations
        } catch (error: any) {
            this.logger.error(`Failed to get pickup locations: ${error.message}`)
            return []
        }
    }

    /**
     * Get pincode for a pickup location by name.
     */
    async getPickupPincode(locationName: string): Promise<string | null> {
        const locations = await this.getPickupLocations(locationName)
        return locations[0]?.pin_code || null
    }

    /**
     * Get delivery estimate for a route.
     * Returns only the preferred courier based on SHIPROCKET_DELIVERY_PREFERENCE env.
     * Cached for 4 hours.
     */
    async getDeliveryEstimate(data: {
        pickup_postcode: string
        delivery_postcode: string
        weight?: number
        cod?: number
    }): Promise<{
        serviceable: boolean
        preference: DeliveryPreference
        courier_name: string | null
        courier_company_id: number | null
        etd: string | null
        estimated_delivery_days: number | null
        rate: number | null
        is_surface: boolean | null
        courier_count: number
    }> {
        await this.ensureToken()

        const weight = data.weight || 0.5
        const cod = data.cod || 0
        const cacheKey = `${data.pickup_postcode}-${data.delivery_postcode}-${weight}-${cod}`

        // LRU eviction: if cache is full, remove oldest entry
        if (this.deliveryEstimateCache.size >= this.maxCacheSize) {
            const firstKey = this.deliveryEstimateCache.keys().next().value
            if (firstKey) {
                this.deliveryEstimateCache.delete(firstKey)
            }
        }

        // Check cache
        const cached = this.deliveryEstimateCache.get(cacheKey)
        if (cached && Date.now() < cached.expiresAt) {
            return cached.response
        }

        try {
            const response = await this.axios.get("/courier/serviceability/", {
                params: {
                    pickup_postcode: data.pickup_postcode,
                    delivery_postcode: data.delivery_postcode,
                    weight,
                    cod,
                }
            })

            const couriers = response.data?.data?.available_courier_companies || []

            if (couriers.length === 0) {
                const result = {
                    serviceable: false,
                    preference: this.deliveryPreference,
                    courier_name: null,
                    courier_company_id: null,
                    etd: null,
                    estimated_delivery_days: null,
                    rate: null,
                    is_surface: null,
                    courier_count: 0,
                }
                // Cache even negative results
                this.deliveryEstimateCache.set(cacheKey, {
                    response: result,
                    expiresAt: Date.now() + DELIVERY_ESTIMATE_CACHE_HOURS * 60 * 60 * 1000,
                })
                return result
            }

            // Select courier based on preference
            let selectedCourier: any
            if (this.deliveryPreference === "CHEAP") {
                selectedCourier = [...couriers].sort((a: any, b: any) => a.rate - b.rate)[0]
            } else {
                // FAST - sort by estimated_delivery_days
                selectedCourier = [...couriers].sort((a: any, b: any) =>
                    (parseInt(a.estimated_delivery_days) || 99) - (parseInt(b.estimated_delivery_days) || 99)
                )[0]
            }

            const result = {
                serviceable: true,
                preference: this.deliveryPreference,
                courier_name: selectedCourier.courier_name,
                courier_company_id: selectedCourier.courier_company_id,
                etd: selectedCourier.etd,
                estimated_delivery_days: parseInt(selectedCourier.estimated_delivery_days) || null,
                rate: selectedCourier.rate,
                is_surface: selectedCourier.is_surface,
                courier_count: couriers.length,
            }

            // Cache result
            this.deliveryEstimateCache.set(cacheKey, {
                response: result,
                expiresAt: Date.now() + DELIVERY_ESTIMATE_CACHE_HOURS * 60 * 60 * 1000,
            })

            return result
        } catch (error: any) {
            if (error instanceof MedusaError) throw error

            this.logger.error(`Failed to get delivery estimate: ${error.message}`)
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                error?.response?.data?.message || "Failed to get delivery estimate"
            )
        }
    }

    /**
     * Get preferred courier for order creation.
     * Returns the courier_company_id based on SHIPROCKET_DELIVERY_PREFERENCE.
     */
    async getPreferredCourier(data: {
        pickup_postcode: string
        delivery_postcode: string
        weight?: number
        cod?: number
    }): Promise<number | null> {
        const estimate = await this.getDeliveryEstimate(data)
        return estimate.courier_company_id
    }
}

/**
 * Get the singleton ShiprocketClientManager instance.
 * Use this in API routes instead of creating new ShiprocketClient instances.
 * 
 * @example
 * ```typescript
 * const manager = getShiprocketManager()
 * const axios = await manager.getAxios()
 * const response = await axios.get("/courier/serviceability/", { params: {...} })
 * ```
 */
export function getShiprocketManager(logger?: Logger): ShiprocketClientManager {
    return ShiprocketClientManager.getInstance(logger)
}

/**
 * Check if Shiprocket credentials are configured.
 */
export function hasShiprocketCredentials(): boolean {
    return ShiprocketClientManager.hasCredentials()
}

/**
 * Reset the client manager (for testing).
 */
export function resetShiprocketManager(): void {
    ShiprocketClientManager.reset()
}

export default ShiprocketClientManager
