/**
 * @file index.ts
 * @brief Private structural helpers.
 * @details Values crossing module boundaries stay unknown until a local helper proves
 * the shape required by that module.
 */

/**
 * @brief Check record.
 * @param value Candidate value.
 * @returns True when the value is a non-array object.
 */
export function isRecord(
    value: unknown
): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @brief Read one own data property without executing accessors.
 * @param value Object being inspected.
 * @param key Property key to read.
 * @returns Stored data-property value, or undefined when absent.
 */
export function readOwnDataProperty(
    value: object,
    key: PropertyKey
): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        return undefined;
    }
    return descriptor.value;
}

/**
 * @brief Clone a readonly path into a frozen public payload.
 * @param path Source path.
 * @returns Frozen path copy.
 */
export function freezePath<TSegment extends string | number>(
    path: readonly TSegment[]
): readonly TSegment[] {
    return Object.freeze([...path]);
}

