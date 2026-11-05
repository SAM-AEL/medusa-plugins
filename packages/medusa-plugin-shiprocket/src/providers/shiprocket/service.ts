import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils";
import {
    CalculatedShippingOptionPrice,
    CalculateShippingOptionPriceDTO,
    CreateFulfillmentResult,
    CreateShippingOptionDTO,
    FulfillmentDTO,
    FulfillmentItemDTO,
    FulfillmentOption,
    FulfillmentOrderDTO,
    Logger,
} from "@medusajs/framework/types";

import ShiprocketClient from "./client";
import { getLineItemDimensions } from "./utils/dimensions";

type InjectedDependencies = {
    logger: Logger;
};

type Options = {
    email: string;
    password: string;
    pickup_location?: string;
    cod?: 0 | 1 | "true" | "false";
    timeout?: number;
};

class ShipRocketFulfillmentProviderService extends AbstractFulfillmentProviderService {
    static identifier = "shiprocket";

    protected logger_: Logger;
    protected options_: Options;
    protected client: ShiprocketClient;

    /**
     * Validates the plugin options at startup.
     * @param options - The plugin configuration options
     * @throws Error if required options are missing
     */
    static validateOptions(options: Record<string, unknown>): void {
        if (!options.email || typeof options.email !== "string") {
            throw new Error("Shiprocket plugin requires 'email' option (API user email)");
        }
        if (!options.password || typeof options.password !== "string") {
            throw new Error("Shiprocket plugin requires 'password' option (API user password)");
        }
        // Validate pickup_location if provided
        if (options.pickup_location && typeof options.pickup_location !== "string") {
            throw new Error("Shiprocket 'pickup_location' option must be a string");
        }
    }

    /**
     * Constructs a new instance of the ShipRocketFulfillmentProviderService.
     */
    constructor({ logger }: InjectedDependencies, options: Options) {
        super();
        this.logger_ = logger;
        this.options_ = options;
        this.client = new ShiprocketClient({
            email: options.email,
            password: options.password,
            pickup_location: options.pickup_location,
            timeout: options.timeout,
            logger: logger,
        });

        this.logger_.info("Shiprocket fulfillment provider initialized");
    }

    /**
     * Returns the fulfillment options for Shiprocket.
     */
    async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
        return [
            {
                id: "shiprocket-standard",
                name: "Standard Shipping",
                is_return: false,
            },
            {
                id: "shiprocket-return",
                name: "Return Shipping",
                is_return: true,
            },
        ];
    }

    /**
     * Determines whether the fulfillment option can calculate the shipping rate.
     */
    async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
        return true;
    }

    /**
     * Calculates the shipping rate for a given order.
     */
    async calculatePrice(
        _optionData: CalculateShippingOptionPriceDTO["optionData"],
        _data: CalculateShippingOptionPriceDTO["data"],
        context: CalculateShippingOptionPriceDTO["context"]
    ): Promise<CalculatedShippingOptionPrice> {
        const pickupPostcode = context["from_location"]?.address?.postal_code as string;
        const deliveryPostcode = context["shipping_address"]?.postal_code as string;

        if (!pickupPostcode) {
            this.logger_.warn(
                "Shiprocket: Missing pickup postcode. Ensure a Stock Location with an address is linked to the Sales Channel."
            );
        }

        if (!pickupPostcode || !deliveryPostcode) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Both pickup and delivery postcodes are required for rate calculation"
            );
        }

        // Calculate total weight from items
        const items = (context["items"] || []) as any[];
        let totalWeightGrams = 0;

        for (const item of items) {
            const quantity = item.quantity || 1;
            const { weightGrams } = getLineItemDimensions(item.variant);
            const itemWeight = weightGrams || item.metadata?.weight || 0;
            totalWeightGrams += itemWeight * quantity;
        }

        // Convert to kg, default to 0.5kg if no weight set
        const weightKg = totalWeightGrams > 0 ? totalWeightGrams / 1000 : 0.5;

        const params = {
            pickup_postcode: pickupPostcode,
            delivery_postcode: deliveryPostcode,
            weight: weightKg,
            cod: (this.options_.cod === "true" || this.options_.cod === 1) ? 1 : 0 as number,
        };

        this.logger_.debug(`Shiprocket: Calculating rate for ${pickupPostcode} -> ${deliveryPostcode}, weight: ${weightKg}kg`);

        const price = await this.client.calculate(params);

        this.logger_.debug(`Shiprocket: Calculated rate: ${price}`);

        return {
            calculated_amount: price,
            is_calculated_price_tax_inclusive: true,
        };
    }

    /**
     * Creates a fulfillment in Shiprocket.
     */
    async createFulfillment(
        data: Record<string, unknown>,
        items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
        order: Partial<FulfillmentOrderDTO> | undefined,
        fulfillment: Partial<Omit<FulfillmentDTO, "provider_id">>
    ): Promise<CreateFulfillmentResult> {
        const orderId = order?.id || "unknown";
        this.logger_.info(`Shiprocket: Creating fulfillment for order ${orderId}`);

        try {
            const externalData = await this.client.create(fulfillment, items, order);

            this.logger_.info(
                `Shiprocket: Fulfillment created - Order ID: ${externalData.order_id}, ` +
                `Shipment ID: ${externalData.shipment_id}, AWB: ${externalData.awb}`
            );

            const { label, manifest, invoice } = await this.client.createDocuments(externalData);

            // Only include label if it was successfully generated
            const labelsEntry = label ? [{
                tracking_number: externalData.tracking_number || "",
                tracking_url: externalData.tracking_url || "",
                label_url: label,
            }] : [];

            return {
                data: {
                    ...((fulfillment as object) || {}),
                    ...externalData,
                },
                labels: labelsEntry,
            };
        } catch (err: any) {
            this.logger_.error(`Shiprocket: Failed to create fulfillment for order ${orderId}: ${err.message}`);
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                err?.message || "Failed to create fulfillment"
            );
        }
    }

    /**
     * Cancels a fulfillment in Shiprocket.
     */
    async cancelFulfillment(data: Record<string, unknown>): Promise<void> {
        const orderId = data.order_id as string;

        if (!orderId) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Shiprocket order_id is required to cancel fulfillment"
            );
        }

        this.logger_.info(`Shiprocket: Cancelling fulfillment for order ${orderId}`);

        await this.client.cancel(orderId);

        this.logger_.info(`Shiprocket: Fulfillment cancelled for order ${orderId}`);
    }

    /**
     * Creates a return fulfillment in Shiprocket.
     */
    async createReturnFulfillment(
        fulfillment: Record<string, any>
    ): Promise<CreateFulfillmentResult> {
        this.logger_.info(`Shiprocket: Creating return fulfillment`);

        try {
            // 1. Get the items from fulfillment
            const items = fulfillment.items || [];
            const lineItemIds = items.map((item: any) => item.line_item_id).filter(Boolean);

            if (lineItemIds.length === 0) {
                throw new MedusaError(
                    MedusaError.Types.INVALID_DATA,
                    "Fulfillment must contain at least one item to create return order"
                );
            }

            // 2. Extract shipping address and email from the fulfillment object if available
            // In Medusa v2, providers don't have direct DB query access, so we rely on the expanded data.
            const order = fulfillment.order;
            const shippingAddress = order?.shipping_address || fulfillment.shipping_address;
            const email = order?.email || fulfillment.email || "customer@example.com";

            // If we don't have a strict shipping address, we gracefully fallback
            // Note: For returns, the customer's address is the pickup address.
            const rawPhone = shippingAddress?.phone || "";
            let cleanedPhone = rawPhone.toString().replace(/[^0-9]/g, "");
            if (cleanedPhone.length === 12 && cleanedPhone.startsWith("91")) {
                cleanedPhone = cleanedPhone.substring(2);
            } else if (cleanedPhone.length === 11 && cleanedPhone.startsWith("0")) {
                cleanedPhone = cleanedPhone.substring(1);
            }
            if (!shippingAddress?.address_1 || !shippingAddress?.city || !shippingAddress?.province || !shippingAddress?.postal_code) {
                throw new MedusaError(
                    MedusaError.Types.INVALID_DATA,
                    "Customer pickup address (address_1, city, province, postal_code) is required for return orders — refusing to send fabricated addresses to the carrier"
                );
            }
            if (!/^[6-9]\d{9}$/.test(cleanedPhone)) {
                throw new MedusaError(
                    MedusaError.Types.INVALID_DATA,
                    "Valid 10-digit customer phone is required for return pickup"
                );
            }

            const pickupAddress = {
                first_name: shippingAddress?.first_name || "Customer",
                last_name: shippingAddress?.last_name || "",
                address_1: shippingAddress.address_1,
                address_2: shippingAddress?.address_2 || "",
                city: shippingAddress.city,
                province: shippingAddress.province,
                country_code: shippingAddress?.country_code || "IN",
                postal_code: shippingAddress.postal_code,
                phone: cleanedPhone,
            };

            // 3. Get warehouse address (delivery_address from return fulfillment)
            const warehouseAddress = fulfillment.delivery_address;
            if (!warehouseAddress) {
                throw new MedusaError(
                    MedusaError.Types.INVALID_DATA,
                    "Fulfillment delivery address (warehouse) is required for shipping details"
                );
            }

            // Normalize shipping phone number
            let rawShippingPhone = warehouseAddress.phone || "";
            let cleanedShippingPhone = rawShippingPhone.toString().replace(/[^0-9]/g, "");
            if (cleanedShippingPhone.length === 12 && cleanedShippingPhone.startsWith("91")) {
                rawShippingPhone = cleanedShippingPhone.substring(2);
            } else if (cleanedShippingPhone.length === 11 && cleanedShippingPhone.startsWith("0")) {
                rawShippingPhone = cleanedShippingPhone.substring(1);
            }

            const shippingAddressWarehouse = {
                first_name: warehouseAddress.first_name || warehouseAddress.company || "Warehouse",
                last_name: warehouseAddress.last_name || "",
                address_1: warehouseAddress.address_1,
                address_2: warehouseAddress.address_2 || "",
                city: warehouseAddress.city,
                province: warehouseAddress.province,
                country_code: warehouseAddress.country_code || "IN",
                postal_code: warehouseAddress.postal_code,
                phone: rawShippingPhone,
                email: warehouseAddress.email || "warehouse@example.com",
            };

            // 4. Map the items
            let subTotal = 0;
            let totalWeight = 0;
            let totalLength = 0;
            let totalBreadth = 0;
            let totalHeight = 0;

            const mappedItems = items.map((item: any) => {
                const qty = Number(item.quantity || 1);
                const price = Number(item.unit_price || 0);
                subTotal += price * qty;

                // We use defaults for dimensions if not provided directly on the item, 
                // since we can't reliably query variants without 'query'
                totalWeight += 0.5 * qty;
                totalLength = Math.max(totalLength, 10);
                totalBreadth = Math.max(totalBreadth, 10);
                totalHeight += 10 * qty;

                return {
                    title: item.title || "Returned Item",
                    sku: item.sku || "RETURN-ITEM",
                    quantity: qty,
                    unit_price: price,
                };
            });

            if (totalWeight === 0) totalWeight = 0.5;
            if (totalLength === 0) totalLength = 10;
            if (totalBreadth === 0) totalBreadth = 10;
            if (totalHeight === 0) totalHeight = 10;

            // 5. Build fulfillment request payload
            const clientPayload = {
                id: fulfillment.id,
                pickup_address: pickupAddress,
                shipping_address: shippingAddressWarehouse,
                email: email,
                items: mappedItems,
                sub_total: subTotal,
                length: totalLength,
                breadth: totalBreadth,
                height: totalHeight,
                weight: totalWeight,
            };

            const externalData = await this.client.createReturn(clientPayload) as any;

            this.logger_.info(
                `Shiprocket: Return fulfillment created - Order ID: ${externalData.order_id}, ` +
                `Shipment ID: ${externalData.shipment_id}`
            );

            // Generate label for the return shipment if possible
            let labelUrl = "";
            try {
                labelUrl = await this.client.generateLabel(externalData);
            } catch (labelErr: any) {
                this.logger_.warn(`Shiprocket: Failed to generate return label: ${labelErr.message}`);
            }

            const labelsEntry = labelUrl ? [{
                tracking_number: externalData.awb_code || "",
                tracking_url: externalData.awb_code ? `https://shiprocket.co/tracking/${encodeURIComponent(externalData.awb_code)}` : "",
                label_url: labelUrl,
            }] : [];

            return {
                data: {
                    ...((fulfillment as object) || {}),
                    ...externalData,
                },
                labels: labelsEntry,
            };
        } catch (err: any) {
            this.logger_.error(`Shiprocket: Failed to create return fulfillment: ${err.message}`);
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                err.message || "Failed to create return fulfillment"
            );
        }
    }

    /**
     * Retrieves the documents associated with a fulfillment.
     */
    async getFulfillmentDocuments(_data: Record<string, unknown>): Promise<never[]> {
        // Shiprocket documents are fetched during fulfillment creation
        return [];
    }

    /**
     * Retrieves the documents associated with a shipment.
     */
    async getShipmentDocuments(_data: any): Promise<never[]> {
        // Shiprocket documents are fetched during fulfillment creation
        return [];
    }

    /**
     * Retrieves the documents associated with a return fulfillment.
     */
    async getReturnDocuments(_data: Record<string, unknown>): Promise<never[]> {
        return [];
    }

    /**
     * Retrieves the documents associated with a fulfillment by type.
     */
    async retrieveDocuments(
        _fulfillmentData: Record<string, unknown>,
        _documentType: string
    ): Promise<void> {
        this.logger_.debug("Shiprocket: Document retrieval by type not supported");
    }

    /**
     * Validates the fulfillment data.
     */
    async validateFulfillmentData(
        _optionData: Record<string, unknown>,
        data: Record<string, unknown>,
        _context: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        return {
            ...data,
            external_id: `shiprocket_${Date.now()}`,
        };
    }

    /**
     * Validates a fulfillment option.
     */
    async validateOption(data: Record<string, unknown>): Promise<boolean> {
        return data.id === "shiprocket-standard" || data.id === "shiprocket-return" || data.external_id !== undefined;
    }
}

export default ShipRocketFulfillmentProviderService;
