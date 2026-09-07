/**
 * Phone Number Utilities for PayU India
 * 
 * Sanitizes phone numbers to 10-digit Indian format
 * Strips: +91, 91, 0091, 0 prefixes
 */

/**
 * Strips Indian phone prefixes to get a clean 10-digit number
 * 
 * Handles:
 * - +91XXXXXXXXXX → XXXXXXXXXX
 * - 91XXXXXXXXXX → XXXXXXXXXX  
 * - 0091XXXXXXXXXX → XXXXXXXXXX
 * - 0XXXXXXXXXX → XXXXXXXXXX (STD code prefix)
 * - XXXXXXXXXX → XXXXXXXXXX (already clean)
 * 
 * @param phone - Raw phone number (may include country code)
 * @returns 10-digit Indian phone number or null if invalid
 */
export function sanitizeIndianPhone(phone: string | undefined | null): string | null {
    if (!phone) {
        return null
    }

    // Remove all non-digit characters (spaces, dashes, parentheses, etc.)
    let digits = phone.replace(/\D/g, "")

    // Handle empty or too short
    if (!digits || digits.length < 10) {
        return null
    }

    // Strip leading 0091 (international dialing prefix)
    if (digits.startsWith("0091") && digits.length >= 14) {
        digits = digits.slice(4)
    }
    // Strip leading 91 (country code)
    else if (digits.startsWith("91") && digits.length >= 12) {
        digits = digits.slice(2)
    }
    // Strip leading 0 (STD prefix for local calls)
    else if (digits.startsWith("0") && digits.length === 11) {
        digits = digits.slice(1)
    }

    // Validate: must be exactly 10 digits and start with 6-9 (valid Indian mobile)
    if (digits.length === 10) {
        const firstDigit = digits.charAt(0)
        if (["6", "7", "8", "9"].includes(firstDigit)) {
            // Valid Indian mobile
            return digits
        }
        return null
    }

    return null
}

/**
 * Validates that a phone number is a valid 10-digit Indian number
 */
export function isValidIndianPhone(phone: string | undefined | null): boolean {
    const sanitized = sanitizeIndianPhone(phone)
    return sanitized !== null && sanitized.length === 10
}
