/**
 * @file index.ts
 * @brief Data-only path helpers for generated payloads.
 * @details Path writes clone containers and read only own data properties, so custom
 * payload wiring does not execute user getters while shaping hostile objects.
 */

import type { PathSegment } from "../contract/node.js";
import { isRecord } from "../internal/index.js";

/**
 * @brief Set a value at a path, cloning containers along the way.
 * @param root Source value.
 * @param path Target path.
 * @param value Replacement value.
 * @returns Updated root value.
 */
export function setPathValue(
    root: unknown,
    path: readonly PathSegment[],
    value: unknown
): unknown {
    if (path.length === 0) {
        return value;
    }
    return setPathSegment(root, path, 0, value);
}

/**
 * @brief Set one segment recursively.
 * @param current Current container.
 * @param path Full path.
 * @param index Current path index.
 * @param value Replacement leaf value.
 * @returns Updated container.
 */
function setPathSegment(
    current: unknown,
    path: readonly PathSegment[],
    index: number,
    value: unknown
): unknown {
    const segment = path[index];
    if (segment === undefined) {
        return value;
    }
    if (typeof segment === "number") {
        const array = isUnknownArray(current) ? [...current] : [];
        array[segment] = index === path.length - 1
            ? value
            : setPathSegment(array[segment], path, index + 1, value);
        return array;
    }
    const record = isRecord(current) ? copyDataRecord(current) : {};
    record[segment] = index === path.length - 1
        ? value
        : setPathSegment(record[segment], path, index + 1, value);
    return record;
}

/**
 * @brief Check unknown array without exposing an implicit any element type.
 * @param value Candidate value.
 * @returns True when value is an array.
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

/**
 * @brief Copy enumerable own data properties.
 * @param source Source object.
 * @returns Mutable data copy.
 */
function copyDataRecord(
    source: Readonly<Record<string, unknown>>
): Record<string, unknown> {
    const copy: Record<string, unknown> = {};
    const keys = Object.keys(source);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (key === undefined) {
            continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (descriptor !== undefined &&
            Object.prototype.hasOwnProperty.call(descriptor, "value")) {
            copy[key] = descriptor.value;
        }
    }
    return copy;
}
