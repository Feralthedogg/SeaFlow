/**
 * @file index.ts
 * @brief Payload shrinking for failing generated cases.
 * @details Shrinking repeatedly tries smaller structural candidates while the caller's
 * predicate still reports the value as interesting.
 */

import { isRecord } from "../internal/index.js";

export type ShrinkPredicate = (value: unknown) => boolean | Promise<boolean>;

export interface ShrinkOptions {
    readonly maxRounds?: number;
    readonly maxCandidates?: number;
}

export interface NormalizedShrinkOptions {
    readonly maxRounds: number;
    readonly maxCandidates: number;
}

export interface ShrinkStep {
    readonly round: number;
    readonly strategy: string;
    readonly value: unknown;
}

export interface ShrinkResult {
    readonly original: unknown;
    readonly value: unknown;
    readonly shrunk: boolean;
    readonly rounds: number;
    readonly attempts: number;
    readonly steps: readonly ShrinkStep[];
}

interface ShrinkCandidate {
    readonly strategy: string;
    readonly value: unknown;
}

const DEFAULT_MAX_ROUNDS = 100;
const DEFAULT_MAX_CANDIDATES = 64;

/**
 * @brief Shrink a value while the predicate remains true.
 * @param value Original interesting value.
 * @param predicate Predicate that returns true when a candidate still reproduces the failure.
 * @param options Shrink budget.
 * @returns Shrink result.
 */
export async function shrink(
    value: unknown,
    predicate: ShrinkPredicate,
    options?: ShrinkOptions
): Promise<ShrinkResult> {
    const normalized = normalizeShrinkOptions(options);
    const original = value;
    let current = value;
    let attempts = 0;
    const steps: ShrinkStep[] = [];
    for (let round = 0; round < normalized.maxRounds; round += 1) {
        const candidates = shrinkCandidates(current, normalized.maxCandidates);
        let accepted = false;
        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            if (candidate === undefined) {
                continue;
            }
            attempts += 1;
            const interesting = await predicate(candidate.value);
            if (!interesting) {
                continue;
            }
            current = candidate.value;
            steps.push(Object.freeze({
                round,
                strategy: candidate.strategy,
                value: candidate.value
            }));
            accepted = true;
            break;
        }
        if (!accepted) {
            return finishShrink(original, current, round, attempts, steps);
        }
    }
    return finishShrink(
        original,
        current,
        normalized.maxRounds,
        attempts,
        steps
    );
}

/**
 * @brief Normalize shrink options.
 * @param options Caller options.
 * @returns Full shrink options.
 */
function normalizeShrinkOptions(
    options: ShrinkOptions | undefined
): NormalizedShrinkOptions {
    return Object.freeze({
        maxRounds: readPositiveInteger(options?.maxRounds, DEFAULT_MAX_ROUNDS, "maxRounds"),
        maxCandidates: readPositiveInteger(
            options?.maxCandidates,
            DEFAULT_MAX_CANDIDATES,
            "maxCandidates"
        )
    });
}

/**
 * @brief Finalize a shrink result.
 * @param original Original value.
 * @param value Current value.
 * @param rounds Completed rounds.
 * @param attempts Candidate attempts.
 * @param steps Accepted shrink steps.
 * @returns Frozen shrink result.
 */
function finishShrink(
    original: unknown,
    value: unknown,
    rounds: number,
    attempts: number,
    steps: readonly ShrinkStep[]
): ShrinkResult {
    return Object.freeze({
        original,
        value,
        shrunk: steps.length !== 0,
        rounds,
        attempts,
        steps: Object.freeze([...steps])
    });
}

/**
 * @brief Build shrink candidates for one value.
 * @param value Source value.
 * @param maxCandidates Candidate limit.
 * @returns Candidate list.
 */
function shrinkCandidates(
    value: unknown,
    maxCandidates: number
): readonly ShrinkCandidate[] {
    const candidates: ShrinkCandidate[] = [];
    pushPrimitiveCandidates(candidates, value, maxCandidates);
    if (candidates.length >= maxCandidates) {
        return Object.freeze(candidates);
    }
    if (isUnknownArray(value)) {
        pushArrayCandidates(candidates, value, maxCandidates);
    } else if (isRecord(value)) {
        pushObjectCandidates(candidates, value, maxCandidates);
    }
    return Object.freeze(candidates.slice(0, maxCandidates));
}

/**
 * @brief Push primitive shrink candidates.
 * @param candidates Candidate sink.
 * @param value Source value.
 * @param maxCandidates Candidate limit.
 */
function pushPrimitiveCandidates(
    candidates: ShrinkCandidate[],
    value: unknown,
    maxCandidates: number
): void {
    if (typeof value === "string") {
        pushCandidate(candidates, "string.empty", "", maxCandidates);
        pushCandidate(candidates, "string.half", value.slice(0, Math.floor(value.length / 2)), maxCandidates);
        return;
    }
    if (typeof value === "number") {
        pushCandidate(candidates, "number.zero", 0, maxCandidates);
        pushCandidate(candidates, "number.half", value / 2, maxCandidates);
        return;
    }
    if (typeof value === "bigint") {
        pushCandidate(candidates, "bigint.zero", 0n, maxCandidates);
        return;
    }
    if (typeof value === "boolean") {
        pushCandidate(candidates, "boolean.false", false, maxCandidates);
        return;
    }
    if (value !== null && value !== undefined) {
        pushCandidate(candidates, "value.null", null, maxCandidates);
    }
}

/**
 * @brief Push array shrink candidates.
 * @param candidates Candidate sink.
 * @param value Source array.
 * @param maxCandidates Candidate limit.
 */
function pushArrayCandidates(
    candidates: ShrinkCandidate[],
    value: readonly unknown[],
    maxCandidates: number
): void {
    pushCandidate(candidates, "array.empty", [], maxCandidates);
    pushCandidate(
        candidates,
        "array.half",
        value.slice(0, Math.floor(value.length / 2)),
        maxCandidates
    );
    for (let index = 0; index < value.length; index += 1) {
        if (candidates.length >= maxCandidates) {
            return;
        }
        const removed = value.filter((_, itemIndex) => itemIndex !== index);
        pushCandidate(candidates, `array.remove.${String(index)}`, removed, maxCandidates);
    }
    for (let index = 0; index < value.length; index += 1) {
        if (candidates.length >= maxCandidates) {
            return;
        }
        const child = value[index];
        const childCandidates = shrinkCandidates(child, 4);
        for (let childIndex = 0; childIndex < childCandidates.length; childIndex += 1) {
            const candidate = childCandidates[childIndex];
            if (candidate === undefined) {
                continue;
            }
            const copy = [...value];
            copy[index] = candidate.value;
            pushCandidate(
                candidates,
                `array.item.${String(index)}.${candidate.strategy}`,
                copy,
                maxCandidates
            );
        }
    }
}

/**
 * @brief Push object shrink candidates.
 * @param candidates Candidate sink.
 * @param value Source object.
 * @param maxCandidates Candidate limit.
 */
function pushObjectCandidates(
    candidates: ShrinkCandidate[],
    value: Readonly<Record<string, unknown>>,
    maxCandidates: number
): void {
    pushCandidate(candidates, "object.empty", {}, maxCandidates);
    const keys = Object.keys(value);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (key === undefined) {
            continue;
        }
        pushCandidate(
            candidates,
            `object.remove.${key}`,
            copyWithoutKey(value, key),
            maxCandidates
        );
        if (candidates.length >= maxCandidates) {
            return;
        }
    }
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (key === undefined || candidates.length >= maxCandidates) {
            return;
        }
        const childCandidates = shrinkCandidates(value[key], 4);
        for (let childIndex = 0; childIndex < childCandidates.length; childIndex += 1) {
            const candidate = childCandidates[childIndex];
            if (candidate === undefined) {
                continue;
            }
            pushCandidate(
                candidates,
                `object.value.${key}.${candidate.strategy}`,
                {
                    ...value,
                    [key]: candidate.value
                },
                maxCandidates
            );
        }
    }
}

/**
 * @brief Push one candidate when it changes the value.
 * @param candidates Candidate sink.
 * @param strategy Strategy label.
 * @param value Candidate value.
 * @param maxCandidates Candidate limit.
 */
function pushCandidate(
    candidates: ShrinkCandidate[],
    strategy: string,
    value: unknown,
    maxCandidates: number
): void {
    if (candidates.length >= maxCandidates) {
        return;
    }
    candidates.push(Object.freeze({
        strategy,
        value
    }));
}

/**
 * @brief Copy an object without one enumerable own data key.
 * @param value Source object.
 * @param omitted Omitted key.
 * @returns New record.
 */
function copyWithoutKey(
    value: Readonly<Record<string, unknown>>,
    omitted: string
): Record<string, unknown> {
    const copy: Record<string, unknown> = {};
    const keys = Object.keys(value);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (key !== undefined && key !== omitted) {
            copy[key] = value[key];
        }
    }
    return copy;
}

/**
 * @brief Read positive integer option.
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

/**
 * @brief Check unknown array without exposing any-typed elements.
 * @param value Candidate value.
 * @returns True when value is an array.
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

