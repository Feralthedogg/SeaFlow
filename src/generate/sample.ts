/**
 * @file sample.ts
 * @brief Public valid sample generation.
 * @details Candidate values are generated from SeaFlow contracts and admitted only
 * after the original TypeSea guard accepts them.
 */

import type {
    Guard,
    Infer,
    Presence
} from "typesea";
import { contractFromGuard } from "../adapters/typesea/index.js";
import { GenerationError } from "../errors/index.js";
import { SeededRng } from "../rng/index.js";
import {
    normalizeGenerationOptions,
    normalizeSamplesOptions
} from "./options.js";
import type {
    GenerationOptions,
    SamplesOptions
} from "./types.js";
import { applyOverrides } from "./overrides.js";
import { generateValidValue } from "./valid.js";

/**
 * @brief Generate one valid sample.
 * @param guard TypeSea guard used as the oracle.
 * @param options Generation options.
 * @returns TypeSea-accepted value.
 */
export function sample<TGuard extends Guard<unknown, Presence>>(
    guard: TGuard,
    options?: GenerationOptions
): Infer<TGuard> {
    const normalized = normalizeGenerationOptions(options);
    const contract = contractFromGuard(guard);
    for (let attempt = 0; attempt < normalized.maxRetries; attempt += 1) {
        const rng = new SeededRng(`${normalized.seed}:valid:${String(attempt)}`);
        const generated = generateValidValue(contract, normalized, rng);
        const value = applyOverrides(
            generated,
            normalized.overrides,
            normalized.seed,
            rng.fork("overrides")
        );
        const result = guard.check(value);
        if (result.ok) {
            return result.value as Infer<TGuard>;
        }
    }
    throw new GenerationError("valid generation exhausted retry budget", {
        seed: normalized.seed,
        path: [],
        strategy: "valid.oracle",
        retries: normalized.maxRetries,
        label: "guard"
    });
}

/**
 * @brief Generate a deterministic stream of valid samples.
 * @param guard TypeSea guard used as the oracle.
 * @param options Stream options.
 * @returns Iterable sample stream.
 */
export function* samples<TGuard extends Guard<unknown, Presence>>(
    guard: TGuard,
    options?: SamplesOptions
): Iterable<Infer<TGuard>> {
    const normalized = normalizeSamplesOptions(options);
    let index = 0;
    while (normalized.count === undefined || index < normalized.count) {
        const nextOptions: GenerationOptions = options?.overrides === undefined
            ? {
                seed: `${normalized.seed}:${String(index)}`,
                depth: normalized.depth,
                maxArrayLength: normalized.maxArrayLength,
                maxRetries: normalized.maxRetries,
                profile: normalized.profile
            }
            : {
                seed: `${normalized.seed}:${String(index)}`,
                depth: normalized.depth,
                maxArrayLength: normalized.maxArrayLength,
                maxRetries: normalized.maxRetries,
                profile: normalized.profile,
                overrides: options.overrides
            };
        yield sample(guard, nextOptions);
        index += 1;
    }
}
