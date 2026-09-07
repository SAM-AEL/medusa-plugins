import { MedusaError } from "@medusajs/utils"

/**
 * Validation utilities for Shiprocket plugin
 * Prevents NaN errors and provides clear user-facing error messages
 */

/**
 * Sanitize and validate Indian phone number
 * @param phone - Phone number string (may contain spaces, dashes, +91, etc.)
 * @param fieldName - Field name for error messages
 * @returns Sanitized numeric phone number
 * @throws MedusaError if phone is invalid
 */
export function validateAndSanitizePhone(phone: string, fieldName: string = "Phone"): number {
    if (!phone) {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${fieldName} is required`
        )
    }

    // Remove all non-numeric characters
    const cleaned = phone.toString().replace(/[^0-9]/g, "")

    // Convert to number
    const num = Number(cleaned)

    // Validate
    if (isNaN(num)) {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${fieldName} contains invalid characters: ${phone}`
        )
    }

    // Indian phone numbers are 10 digits
    if (cleaned.length !== 10) {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${fieldName} must be 10 digits, got ${cleaned.length}: ${phone}`
        )
    }

    return num
}

/**
 * Sanitize and validate Indian pincode
 * @param pincode - Pincode string
 * @param fieldName - Field name for error messages
 * @returns Sanitized numeric pincode
 * @throws MedusaError if pincode is invalid
 */
export function validateAndSanitizePincode(pincode: string, fieldName: string = "Pincode"): number {
    if (!pincode) {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${fieldName} is required`
        )
    }

    // Remove all non-numeric characters
    const cleaned = pincode.toString().replace(/[^0-9]/g, "")

    // Convert to number
    const num = Number(cleaned)

    // Validate
    if (isNaN(num)) {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${fieldName} contains invalid characters: ${pincode}`
        )
    }

    // Indian pincodes are exactly 6 digits
    if (!/^\d{6}$/.test(cleaned)) {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${fieldName} must be 6 digits, got ${cleaned.length}: ${pincode}`
        )
    }

    return num
}

/**
 * Validate required field
 * @param value - Value to check
 * @param fieldName - Field name for error messages
 * @returns The value if present
 * @throws MedusaError if value is missing
 */
export function requireField<T>(value: T | null | undefined, fieldName: string): T {
    if (value === undefined || value === null || value === "") {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Missing required field: ${fieldName}`
        )
    }
    return value
}
