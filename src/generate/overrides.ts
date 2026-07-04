/**
 * @file overrides.ts
 * @brief User-defined valid sample overrides.
 * @details Overrides are applied after structural generation and before TypeSea oracle
 * admission, so invalid overrides fail within the existing retry budget.
 */

import type { PathSegment } from "../contract/node.js";
import { isRecord, readOwnDataProperty } from "../internal/index.js";
import { setPathValue } from "../path/index.js";
import type { Rng } from "../rng/index.js";
import type {
    NormalizedOverrideRule,
    OverrideContext,
    OverrideFunction,
    OverrideMap,
    OverrideRule,
    Overrides
} from "./types.js";

/**
 * @brief Normalize user override options.
 * @param overrides Caller override options.
 * @returns Normalized override rules.
 */
export function normalizeOverrides(
    overrides: Overrides | undefined
): readonly NormalizedOverrideRule[] {
    if (overrides === undefined) {
        return Object.freeze([]);
    }
    if (isOverrideRuleArray(overrides)) {
        const rules = new Array<NormalizedOverrideRule>(overrides.length);
        for (let index = 0; index < overrides.length; index += 1) {
            const override = overrides[index];
            if (override !== undefined) {
                rules[index] = normalizeOverrideRule(override);
            }
        }
        return Object.freeze(rules);
    }
    return normalizeOverrideMap(overrides);
}

/**
 * @brief Apply overrides to a generated value.
 * @param value Generated value.
 * @param overrides Normalized override rules.
 * @param seed Active seed.
 * @param rng Override random source.
 * @returns Updated value.
 */
export function applyOverrides(
    value: unknown,
    overrides: readonly NormalizedOverrideRule[],
    seed: string,
    rng: Rng
): unknown {
    let next = value;
    for (let index = 0; index < overrides.length; index += 1) {
        const override = overrides[index];
        if (override === undefined) {
            continue;
        }
        const context: OverrideContext = Object.freeze({
            path: override.path,
            seed,
            rng: rng.fork(`override:${String(index)}`)
        });
        next = setPathValue(next, override.path, resolveOverrideValue(override.source, context));
    }
    return next;
}

/**
 * @brief Normalize one override rule.
 * @param override Raw override rule.
 * @returns Normalized rule.
 */
function normalizeOverrideRule(
    override: OverrideRule
): NormalizedOverrideRule {
    return Object.freeze({
        path: Object.freeze([...override.path]),
        source: override.value
    });
}

/**
 * @brief Normalize object-map override syntax.
 * @param overrides Override map.
 * @returns Normalized rules.
 */
function normalizeOverrideMap(
    overrides: OverrideMap
): readonly NormalizedOverrideRule[] {
    const keys = Object.keys(overrides);
    const rules = new Array<NormalizedOverrideRule>(keys.length);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (key === undefined) {
            continue;
        }
        rules[index] = Object.freeze({
            path: Object.freeze(parsePathKey(key)),
            source: overrides[key]
        });
    }
    return Object.freeze(rules);
}

/**
 * @brief Resolve an override source into a concrete value.
 * @param source Override source.
 * @param context Override context.
 * @returns Override value.
 */
function resolveOverrideValue(
    source: unknown,
    context: OverrideContext
): unknown {
    if (isOverrideFunction(source)) {
        return source(context);
    }
    if (isRecord(source)) {
        const generate = readOwnDataProperty(source, "generate");
        if (isOverrideFunction(generate)) {
            return generate(context);
        }
        const value = readOwnDataProperty(source, "value");
        if (Object.prototype.hasOwnProperty.call(source, "value")) {
            return value;
        }
    }
    return source;
}

/**
 * @brief Parse a dotted override map key.
 * @param key Override map key.
 * @returns Path segments.
 */
function parsePathKey(key: string): readonly PathSegment[] {
    const parts = key.split(".");
    const path = new Array<PathSegment>(parts.length);
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? "";
        path[index] = /^\d+$/u.test(part) ? Number(part) : part;
    }
    return path;
}

/**
 * @brief Check override callback shape.
 * @param value Candidate value.
 * @returns True when the value is callable as an override function.
 */
function isOverrideFunction(value: unknown): value is OverrideFunction {
    return typeof value === "function";
}

/**
 * @brief Narrow overrides to rule-array syntax.
 * @param value Candidate overrides.
 * @returns True when overrides are supplied as explicit rules.
 */
function isOverrideRuleArray(value: Overrides): value is readonly OverrideRule[] {
    return Array.isArray(value);
}
