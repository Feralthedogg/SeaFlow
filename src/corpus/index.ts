/**
 * @file index.ts
 * @brief JSON-safe corpus persistence.
 * @details Corpora store generated failure payloads as data so CI can replay and inspect
 * regressions without rerunning the original generator stream.
 */

import { readFile, writeFile } from "node:fs/promises";
import type {
    Guard,
    Infer,
    Presence
} from "typesea";
import type { FuzzCase } from "../generate/types.js";
import {
    inspect,
    type InspectionReport
} from "../inspect/index.js";
import { isRecord } from "../internal/index.js";
import type { SuiteReport } from "../suite/index.js";

export interface Corpus {
    readonly version: 1;
    readonly createdAt: string;
    readonly cases: readonly CorpusCase[];
}

export interface CorpusCase {
    readonly id: string;
    readonly kind: CorpusCaseKind;
    readonly value: JsonValue;
    readonly strategy: string | undefined;
    readonly reason: string | undefined;
}

export type CorpusCaseKind =
    | "valid"
    | "invalid"
    | "unknown";

export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonArray
    | JsonObject;

export type JsonArray = readonly JsonValue[];

export interface JsonObject {
    readonly [key: string]: JsonValue;
}

/**
 * @brief Build a corpus from fuzz cases.
 * @param cases Fuzz cases.
 * @returns Frozen corpus.
 */
export function corpusFromFuzzCases(cases: readonly FuzzCase[]): Corpus {
    const corpusCases = new Array<CorpusCase>(cases.length);
    for (let index = 0; index < cases.length; index += 1) {
        const case_ = cases[index];
        if (case_ === undefined) {
            continue;
        }
        corpusCases[index] = makeCorpusCase(
            case_.id,
            "invalid",
            case_.value,
            case_.strategy,
            case_.reason
        );
    }
    return makeCorpus(corpusCases);
}

/**
 * @brief Build a corpus from a suite report.
 * @param report Suite report.
 * @returns Frozen corpus.
 */
export function corpusFromReport<TValue, TResult>(
    report: SuiteReport<TValue, TResult>
): Corpus {
    const corpusCases: CorpusCase[] = [];
    for (let index = 0; index < report.results.length; index += 1) {
        const result = report.results[index];
        if (result === undefined || result.ok) {
            continue;
        }
        const case_ = result.case;
        corpusCases.push(makeCorpusCase(
            case_.id,
            case_.kind,
            result.shrunk?.value ?? case_.value,
            case_.kind === "invalid" ? case_.fuzz.strategy : undefined,
            case_.kind === "invalid" ? case_.fuzz.reason : undefined
        ));
    }
    return makeCorpus(corpusCases);
}

/**
 * @brief Persist a corpus to disk.
 * @param path Output path.
 * @param corpus Corpus value.
 */
export async function writeCorpus(path: string, corpus: Corpus): Promise<void> {
    await writeFile(path, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
}

/**
 * @brief Read and validate a corpus from disk.
 * @param path Input path.
 * @returns Frozen corpus.
 */
export async function readCorpus(path: string): Promise<Corpus> {
    const source = await readFile(path, "utf8");
    const parsed = JSON.parse(source) as unknown;
    return readCorpusValue(parsed);
}

/**
 * @brief Inspect stored corpus cases with a TypeSea guard.
 * @param guard TypeSea guard.
 * @param corpus Corpus to inspect.
 * @returns Inspection report.
 */
export function inspectCorpus<TGuard extends Guard<unknown, Presence>>(
    guard: TGuard,
    corpus: Corpus
): InspectionReport<Infer<TGuard>> {
    return inspect(guard, corpus.cases.map((case_) => Object.freeze({
        id: case_.id,
        value: case_.value
    })));
}

/**
 * @brief Construct a frozen corpus.
 * @param cases Corpus cases.
 * @returns Corpus.
 */
function makeCorpus(cases: readonly CorpusCase[]): Corpus {
    return Object.freeze({
        version: 1,
        createdAt: new Date().toISOString(),
        cases: Object.freeze([...cases])
    });
}

/**
 * @brief Construct one corpus case.
 * @param id Case id.
 * @param kind Case kind.
 * @param value Runtime value.
 * @param strategy Strategy label.
 * @param reason Failure reason.
 * @returns Corpus case.
 */
function makeCorpusCase(
    id: string,
    kind: CorpusCaseKind,
    value: unknown,
    strategy: string | undefined,
    reason: string | undefined
): CorpusCase {
    return Object.freeze({
        id,
        kind,
        value: toJsonValue(value, []),
        strategy,
        reason
    });
}

/**
 * @brief Convert a runtime value into a JSON-safe corpus value.
 * @param value Runtime value.
 * @param seen Cycle detection stack.
 * @returns JSON value.
 */
function toJsonValue(
    value: unknown,
    seen: readonly object[]
): JsonValue {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError("corpus numbers must be finite");
        }
        return value;
    }
    if (Array.isArray(value)) {
        return toJsonArray(value, seen);
    }
    if (isRecord(value)) {
        return toJsonObject(value, seen);
    }
    throw new TypeError("corpus values must be JSON-serializable");
}

/**
 * @brief Convert an array to JSON-safe values.
 * @param value Runtime array.
 * @param seen Cycle detection stack.
 * @returns JSON array.
 */
function toJsonArray(
    value: readonly unknown[],
    seen: readonly object[]
): JsonArray {
    if (seen.includes(value)) {
        throw new TypeError("corpus values must not contain cycles");
    }
    const nextSeen = Object.freeze([...seen, value]);
    const array = new Array<JsonValue>(value.length);
    for (let index = 0; index < value.length; index += 1) {
        array[index] = toJsonValue(value[index], nextSeen);
    }
    return Object.freeze(array);
}

/**
 * @brief Convert a record to JSON-safe values without running getters.
 * @param value Runtime record.
 * @param seen Cycle detection stack.
 * @returns JSON object.
 */
function toJsonObject(
    value: Readonly<Record<string, unknown>>,
    seen: readonly object[]
): JsonObject {
    if (seen.includes(value)) {
        throw new TypeError("corpus values must not contain cycles");
    }
    const nextSeen = Object.freeze([...seen, value]);
    const object: Record<string, JsonValue> = {};
    const keys = Object.keys(value);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (key === undefined) {
            continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined ||
            !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
            throw new TypeError("corpus object properties must be data properties");
        }
        object[key] = toJsonValue(descriptor.value, nextSeen);
    }
    return Object.freeze(object);
}

/**
 * @brief Validate parsed corpus value.
 * @param value Parsed JSON value.
 * @returns Corpus.
 */
function readCorpusValue(value: unknown): Corpus {
    if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["cases"])) {
        throw new TypeError("invalid SeaFlow corpus");
    }
    const rawCases = value["cases"];
    const cases = new Array<CorpusCase>(rawCases.length);
    for (let index = 0; index < rawCases.length; index += 1) {
        cases[index] = readCorpusCase(rawCases[index]);
    }
    const createdAt = value["createdAt"];
    return Object.freeze({
        version: 1,
        createdAt: typeof createdAt === "string" ? createdAt : "",
        cases: Object.freeze(cases)
    });
}

/**
 * @brief Validate one parsed corpus case.
 * @param value Parsed case.
 * @returns Corpus case.
 */
function readCorpusCase(value: unknown): CorpusCase {
    if (!isRecord(value)) {
        throw new TypeError("invalid SeaFlow corpus case");
    }
    const id = value["id"];
    const kind = value["kind"];
    const caseValue = value["value"];
    const strategy = value["strategy"];
    const reason = value["reason"];
    if (typeof id !== "string" ||
        !isCorpusCaseKind(kind) ||
        !isJsonValue(caseValue)) {
        throw new TypeError("invalid SeaFlow corpus case");
    }
    return Object.freeze({
        id,
        kind,
        value: caseValue,
        strategy: typeof strategy === "string" ? strategy : undefined,
        reason: typeof reason === "string" ? reason : undefined
    });
}

/**
 * @brief Check corpus case kind.
 * @param value Candidate value.
 * @returns True when valid.
 */
function isCorpusCaseKind(value: unknown): value is CorpusCaseKind {
    return value === "valid" || value === "invalid" || value === "unknown";
}

/**
 * @brief Check JSON value.
 * @param value Candidate value.
 * @returns True when JSON-safe.
 */
function isJsonValue(value: unknown): value is JsonValue {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            if (!isJsonValue(value[index])) {
                return false;
            }
        }
        return true;
    }
    if (isRecord(value)) {
        const keys = Object.keys(value);
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            if (key === undefined || !isJsonValue(value[key])) {
                return false;
            }
        }
        return true;
    }
    return false;
}
