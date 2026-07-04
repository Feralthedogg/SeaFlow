/**
 * @file options.ts
 * @brief Option normalization for generators.
 * @details Public option objects are narrowed once before generator hot paths run.
 */

import { normalizeSeed } from "../rng/index.js";
import type { PayloadPackName } from "../payloads/index.js";
import { normalizeOverrides } from "./overrides.js";
import type {
    FuzzOptions,
    FuzzTarget,
    GenerationOptions,
    NormalizedFuzzTarget,
    NormalizedFuzzOptions,
    NormalizedGenerationOptions,
    SamplesOptions
} from "./types.js";

const DEFAULT_DEPTH = 4;
const DEFAULT_MAX_ARRAY_LENGTH = 3;
const DEFAULT_MAX_RETRIES = 100;
const DEFAULT_COUNT = 1;

/**
 * @brief Normalize valid generation options.
 * @param options Caller options.
 * @returns Fully populated options.
 */
export function normalizeGenerationOptions(
    options: GenerationOptions | undefined
): NormalizedGenerationOptions {
    return Object.freeze({
        seed: normalizeSeed(options?.seed),
        depth: readNonNegativeInteger(options?.depth, DEFAULT_DEPTH, "depth"),
        maxArrayLength: readNonNegativeInteger(
            options?.maxArrayLength,
            DEFAULT_MAX_ARRAY_LENGTH,
            "maxArrayLength"
        ),
        maxRetries: readPositiveInteger(
            options?.maxRetries,
            DEFAULT_MAX_RETRIES,
            "maxRetries"
        ),
        profile: options?.profile ?? "typical",
        overrides: normalizeOverrides(options?.overrides)
    });
}

/**
 * @brief Normalize sample stream options.
 * @param options Caller options.
 * @returns Valid generation options plus count.
 */
export function normalizeSamplesOptions(
    options: SamplesOptions | undefined
): NormalizedGenerationOptions & { readonly count: number | undefined } {
    const generation = normalizeGenerationOptions(options);
    const count = options?.count === undefined
        ? undefined
        : readNonNegativeInteger(options.count, DEFAULT_COUNT, "count");
    return Object.freeze({
        ...generation,
        count
    });
}

/**
 * @brief Normalize fuzzing options.
 * @param options Caller options.
 * @returns Fully populated fuzz options.
 */
export function normalizeFuzzOptions(
    options: FuzzOptions | undefined
): NormalizedFuzzOptions {
    return Object.freeze({
        seed: normalizeSeed(options?.seed),
        depth: readNonNegativeInteger(options?.depth, DEFAULT_DEPTH, "depth"),
        maxArrayLength: readNonNegativeInteger(
            options?.maxArrayLength,
            DEFAULT_MAX_ARRAY_LENGTH,
            "maxArrayLength"
        ),
        maxRetries: readPositiveInteger(
            options?.maxRetries,
            DEFAULT_MAX_RETRIES,
            "maxRetries"
        ),
        count: readNonNegativeInteger(options?.count, DEFAULT_COUNT, "count"),
        mode: options?.mode ?? "invalid",
        profile: options?.profile ?? "boundary",
        domain: options?.domain ?? "json",
        targets: normalizeFuzzTargets(options?.targets),
        packs: freezePackNames(options?.packs)
    });
}

/**
 * @brief Normalize fuzz target options.
 * @param targets Caller targets.
 * @returns Frozen target rules.
 */
function normalizeFuzzTargets(
    targets: readonly FuzzTarget[] | undefined
): readonly NormalizedFuzzTarget[] {
    if (targets === undefined) {
        return Object.freeze([]);
    }
    const normalized = new Array<NormalizedFuzzTarget>(targets.length);
    for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        if (target === undefined) {
            continue;
        }
        normalized[index] = Object.freeze({
            path: Object.freeze([...target.path]),
            values: Object.freeze([...(target.values ?? [])]),
            packs: freezePackNames(target.packs),
            strategy: target.strategy,
            reason: target.reason
        });
    }
    return Object.freeze(normalized);
}

/**
 * @brief Freeze payload pack names.
 * @param packs Candidate pack list.
 * @returns Frozen pack list.
 */
function freezePackNames(
    packs: readonly PayloadPackName[] | undefined
): readonly PayloadPackName[] {
    return Object.freeze([...(packs ?? [])]);
}

/**
 * @brief Read a non-negative integer option.
 * @param value Candidate value.
 * @param fallback Default value.
 * @param label Option label.
 * @returns Normalized integer.
 */
function readNonNegativeInteger(
    value: number | undefined,
    fallback: number,
    label: string
): number {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative integer`);
    }
    return value;
}

/**
 * @brief Read a positive integer option.
 * @param value Candidate value.
 * @param fallback Default value.
 * @param label Option label.
 * @returns Normalized integer.
 */
function readPositiveInteger(
    value: number | undefined,
    fallback: number,
    label: string
): number {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new TypeError(`${label} must be a positive integer`);
    }
    return value;
}
