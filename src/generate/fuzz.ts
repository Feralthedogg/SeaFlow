/**
 * @file fuzz.ts
 * @brief Public invalid fuzz case generation.
 * @details Fuzz cases are emitted only after the TypeSea oracle rejects them.
 */

import type {
    Guard,
    Presence
} from "typesea";
import { contractFromGuard } from "../adapters/typesea/index.js";
import type { Contract } from "../contract/node.js";
import { GenerationError } from "../errors/index.js";
import { freezePath } from "../internal/index.js";
import { SeededRng } from "../rng/index.js";
import { normalizeFuzzOptions } from "./options.js";
import type {
    FuzzCase,
    FuzzOptions,
    NormalizedFuzzTarget,
    NormalizedFuzzOptions
} from "./types.js";
import { generateValidValue } from "./valid.js";
import { mutateInvalid } from "./mutate.js";
import { payloadValuesForPacks } from "../payloads/index.js";
import { setPathValue } from "../path/index.js";
import type { Rng } from "../rng/index.js";

type TargetFactory = (context: TargetFactoryContext) => unknown;

interface TargetFactoryContext {
    readonly path: readonly (string | number)[];
    readonly seed: string;
    readonly rng: Rng;
}

/**
 * @brief Generate invalid fuzz cases.
 * @param guard TypeSea guard used as the oracle.
 * @param options Fuzz options.
 * @returns Iterable fuzz case stream.
 */
export function* fuzz(
    guard: Guard<unknown, Presence>,
    options?: FuzzOptions
): Iterable<FuzzCase> {
    const normalized = normalizeFuzzOptions(options);
    const contract = contractFromGuard(guard);
    for (let index = 0; index < normalized.count; index += 1) {
        yield makeFuzzCase(guard, contract, normalized, index);
    }
}

/**
 * @brief Build one fuzz case.
 * @param guard TypeSea guard.
 * @param contract Normalized contract.
 * @param options Normalized fuzz options.
 * @param index Case index.
 * @returns Rejected fuzz case.
 */
function makeFuzzCase(
    guard: Guard<unknown, Presence>,
    contract: Contract,
    options: NormalizedFuzzOptions,
    index: number
): FuzzCase {
    for (let attempt = 0; attempt < options.maxRetries; attempt += 1) {
        const seed = `${options.seed}:invalid:${String(index)}:${String(attempt)}`;
        const rng = new SeededRng(seed);
        const valid = generateValidValue(contract, {
            seed,
            depth: options.depth,
            maxArrayLength: options.maxArrayLength,
            maxRetries: options.maxRetries,
            profile: "typical",
            overrides: Object.freeze([])
        }, rng.fork("base"));
        const candidate = makeCandidate(contract, valid, options, rng, index, attempt);
        const result = guard.check(candidate.value);
        if (!result.ok) {
            const fuzzCase: FuzzCase = {
                id: `sf:${options.seed}:invalid:${String(index)}:${candidate.strategy}`,
                seed: options.seed,
                index,
                value: candidate.value,
                valid: false,
                strategy: candidate.strategy,
                path: freezePath(candidate.path),
                reason: candidate.reason,
                issues: Object.freeze([...result.error])
            };
            return Object.freeze(fuzzCase);
        }
    }
    throw new GenerationError("invalid fuzzing exhausted retry budget", {
        seed: options.seed,
        path: [],
        strategy: "invalid.oracle",
        retries: options.maxRetries,
        label: "guard"
    });
}

/**
 * @brief Build a custom target or automatic mutation candidate.
 * @param contract Contract graph.
 * @param valid Valid base value.
 * @param options Normalized fuzz options.
 * @param rng Deterministic random source.
 * @param index Case index.
 * @param attempt Retry attempt.
 * @returns Mutation candidate.
 */
function makeCandidate(
    contract: Contract,
    valid: unknown,
    options: NormalizedFuzzOptions,
    rng: Rng,
    index: number,
    attempt: number
): ReturnType<typeof mutateInvalid> {
    const custom = makeCustomCandidate(valid, options, rng, index, attempt);
    if (custom !== undefined) {
        return custom;
    }
    return mutateInvalid(contract, valid, rng.fork("mutate"), options.domain);
}

/**
 * @brief Build a user-targeted candidate.
 * @param valid Valid base value.
 * @param options Normalized fuzz options.
 * @param rng Deterministic random source.
 * @param index Case index.
 * @param attempt Retry attempt.
 * @returns Custom candidate or undefined.
 */
function makeCustomCandidate(
    valid: unknown,
    options: NormalizedFuzzOptions,
    rng: Rng,
    index: number,
    attempt: number
): ReturnType<typeof mutateInvalid> | undefined {
    const targets = effectiveTargets(options);
    if (targets.length === 0) {
        return undefined;
    }
    const target = targets[(index + attempt) % targets.length];
    if (target === undefined) {
        return undefined;
    }
    const values = valuesForTarget(target, options);
    if (values.length === 0) {
        return undefined;
    }
    const valueIndex = rng.pickIndex(values.length);
    const raw = values[valueIndex];
    const payload = isTargetFactory(raw)
        ? raw(Object.freeze({
            path: target.path,
            seed: options.seed,
            rng: rng.fork("target")
        }))
        : raw;
    const strategy = target.strategy ?? `target.${target.path.join(".")}`;
    return Object.freeze({
        value: setPathValue(valid, target.path, payload),
        strategy,
        path: target.path,
        reason: target.reason ?? "user-defined target payload"
    });
}

/**
 * @brief Resolve target list including global packs.
 * @param options Normalized fuzz options.
 * @returns Effective targets.
 */
function effectiveTargets(
    options: NormalizedFuzzOptions
): readonly NormalizedFuzzTarget[] {
    if (options.targets.length !== 0) {
        return options.targets;
    }
    if (options.packs.length === 0) {
        return Object.freeze([]);
    }
    return Object.freeze([
        Object.freeze({
            path: Object.freeze([]),
            values: Object.freeze([]),
            packs: options.packs,
            strategy: "target.root.pack",
            reason: "global payload pack at root"
        })
    ]);
}

/**
 * @brief Resolve all values for a target.
 * @param target Normalized target.
 * @param options Normalized fuzz options.
 * @returns Candidate payloads.
 */
function valuesForTarget(
    target: NormalizedFuzzTarget,
    options: NormalizedFuzzOptions
): readonly unknown[] {
    const packValues = payloadValuesForPacks(
        target.packs.length === 0 ? options.packs : target.packs
    );
    return Object.freeze([
        ...target.values,
        ...packValues
    ]);
}

/**
 * @brief Check target factory shape.
 * @param value Candidate value.
 * @returns True when callable as a target factory.
 */
function isTargetFactory(value: unknown): value is TargetFactory {
    return typeof value === "function";
}
