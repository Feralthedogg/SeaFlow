/**
 * @file index.ts
 * @brief Case id replay.
 * @details Replay parses SeaFlow case ids and regenerates the corresponding payload using
 * the same seed and caller-supplied generation or fuzzing options.
 */

import type {
    Guard,
    Infer,
    Presence
} from "typesea";
import { fuzz } from "../generate/fuzz.js";
import { sample } from "../generate/sample.js";
import type {
    FuzzCase,
    FuzzOptions,
    GenerationOptions
} from "../generate/types.js";

const EMPTY_GENERATION_OPTIONS: GenerationOptions = Object.freeze({});
const EMPTY_FUZZ_OPTIONS: FuzzOptions = Object.freeze({});

export interface ParsedCaseId {
    readonly seed: string;
    readonly stream: ReplayStream;
    readonly index: number;
    readonly strategy: string | undefined;
}

export type ReplayStream =
    | "valid"
    | "invalid";

export interface ReplayOptions {
    readonly valid?: GenerationOptions;
    readonly invalid?: FuzzOptions;
}

export type ReplayResult<TValue> =
    | ValidReplayResult<TValue>
    | InvalidReplayResult;

export interface ValidReplayResult<TValue> {
    readonly id: string;
    readonly parsed: ParsedCaseId;
    readonly kind: "valid";
    readonly value: TValue;
}

export interface InvalidReplayResult {
    readonly id: string;
    readonly parsed: ParsedCaseId;
    readonly kind: "invalid";
    readonly value: unknown;
    readonly fuzz: FuzzCase;
}

/**
 * @brief Replay a SeaFlow case id.
 * @param guard TypeSea guard.
 * @param id Case id.
 * @param options Replay options.
 * @returns Replayed payload.
 */
export function replay<TGuard extends Guard<unknown, Presence>>(
    guard: TGuard,
    id: string,
    options?: ReplayOptions
): ReplayResult<Infer<TGuard>> {
    const parsed = parseCaseId(id);
    if (parsed.stream === "valid") {
        const value = sample(guard, replayValidOptions(parsed, options?.valid));
        return Object.freeze({
            id,
            parsed,
            kind: "valid",
            value
        });
    }
    const fuzzCase = replayInvalidCase(guard, parsed, options?.invalid);
    return Object.freeze({
        id,
        parsed,
        kind: "invalid",
        value: fuzzCase.value,
        fuzz: fuzzCase
    });
}

/**
 * @brief Parse a SeaFlow case id.
 * @param id Case id.
 * @returns Parsed id.
 */
export function parseCaseId(id: string): ParsedCaseId {
    const parts = id.split(":");
    if (parts[0] !== "sf") {
        throw new TypeError("case id must start with sf:");
    }
    const streamIndex = findStreamIndex(parts);
    const indexPart = parts[streamIndex + 1];
    if (indexPart === undefined || !/^\d+$/u.test(indexPart)) {
        throw new TypeError("case id must contain a numeric index");
    }
    const seedParts = parts.slice(1, streamIndex);
    if (seedParts.length === 0) {
        throw new TypeError("case id must contain a seed");
    }
    const strategyParts = parts.slice(streamIndex + 2);
    return Object.freeze({
        seed: seedParts.join(":"),
        stream: parts[streamIndex] as ReplayStream,
        index: Number(indexPart),
        strategy: strategyParts.length === 0
            ? undefined
            : strategyParts.join(":")
    });
}

/**
 * @brief Find the stream marker in split case id parts.
 * @param parts Case id parts.
 * @returns Stream marker index.
 */
function findStreamIndex(parts: readonly string[]): number {
    for (let index = parts.length - 2; index >= 2; index -= 1) {
        const part = parts[index];
        const next = parts[index + 1];
        if ((part === "valid" || part === "invalid") &&
            next !== undefined &&
            /^\d+$/u.test(next)) {
            return index;
        }
    }
    throw new TypeError("case id must contain a valid or invalid stream");
}

/**
 * @brief Build valid replay options.
 * @param parsed Parsed id.
 * @param options Caller valid options.
 * @returns Generation options.
 */
function replayValidOptions(
    parsed: ParsedCaseId,
    options: GenerationOptions | undefined
): GenerationOptions {
    const base = options ?? EMPTY_GENERATION_OPTIONS;
    let replayOptions: GenerationOptions = {
        seed: `${parsed.seed}:${String(parsed.index)}`
    };
    replayOptions = copyGenerationOptions(base, replayOptions);
    return replayOptions;
}

/**
 * @brief Replay an invalid fuzz case.
 * @param guard TypeSea guard.
 * @param parsed Parsed id.
 * @param options Caller fuzz options.
 * @returns Fuzz case.
 */
function replayInvalidCase(
    guard: Guard<unknown, Presence>,
    parsed: ParsedCaseId,
    options: FuzzOptions | undefined
): FuzzCase {
    const base = options ?? EMPTY_FUZZ_OPTIONS;
    const cases = fuzz(guard, {
        ...base,
        seed: parsed.seed,
        count: parsed.index + 1
    });
    let current: FuzzCase | undefined;
    for (const case_ of cases) {
        current = case_;
    }
    if (current === undefined) {
        throw new TypeError("case id index did not produce a fuzz case");
    }
    return current;
}

/**
 * @brief Copy defined generation options onto a replay option object.
 * @param source Source options.
 * @param target Target options.
 * @returns Copied options.
 */
function copyGenerationOptions(
    source: GenerationOptions,
    target: GenerationOptions
): GenerationOptions {
    let next = target;
    if (source.depth !== undefined) {
        next = {
            ...next,
            depth: source.depth
        };
    }
    if (source.maxArrayLength !== undefined) {
        next = {
            ...next,
            maxArrayLength: source.maxArrayLength
        };
    }
    if (source.maxRetries !== undefined) {
        next = {
            ...next,
            maxRetries: source.maxRetries
        };
    }
    if (source.profile !== undefined) {
        next = {
            ...next,
            profile: source.profile
        };
    }
    if (source.overrides !== undefined) {
        next = {
            ...next,
            overrides: source.overrides
        };
    }
    return next;
}
