/**
 * Extracts dimensions and weight from a variant, falling back to the parent product if necessary.
 * Medusa stores dimensions as numbers, Shiprocket expects weight in kg.
 */
export function getLineItemDimensions(variant: any) {
    const product = variant?.product;

    const weightGrams = Number(variant?.weight || product?.weight || 0);
    const length = Number(variant?.length || product?.length || 0);
    const width = Number(variant?.width || product?.width || 0);
    const height = Number(variant?.height || product?.height || 0);

    return {
        weightGrams,
        weightKg: weightGrams / 1000,
        length,
        width,
        height,
    };
}
