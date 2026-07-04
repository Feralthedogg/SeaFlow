/**
 * @file index.ts
 * @brief Generated case runner API.
 * @details Suites assemble valid and invalid SeaFlow cases, run them against a user
 * target, collect outputs, and optionally shrink failing payloads.
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
    GenerationOptions,
    SamplesOptions
} from "../generate/types.js";
import {
    shrink,
    type ShrinkOptions,
    type ShrinkResult
} from "../shrink/index.js";

export interface Suite<TValue> {
    valid(options?: SamplesOptions): Suite<TValue>;
    invalid(options?: FuzzOptions): Suite<TValue>;
    against<TResult>(
        runner: SuiteRunner<TValue, TResult>,
        options?: SuiteAgainstOptions<TValue, TResult>
    ): Promise<SuiteReport<TValue, TResult>>;
}

export type SuiteRunner<TValue, TResult> =
    (case_: SuiteCase<TValue>) => TResult | Promise<TResult>;

export type SuiteFailPredicate<TValue, TResult> =
    (result: TResult, case_: SuiteCase<TValue>) => boolean | Promise<boolean>;

export interface SuiteAgainstOptions<TValue, TResult> {
    readonly failWhen?: SuiteFailPredicate<TValue, TResult>;
    readonly shrink?: boolean | ShrinkOptions;
    readonly concurrency?: number;
    readonly timeoutMs?: number;
    readonly retries?: number;
    readonly signal?: AbortSignal;
    readonly stopOnFailure?: boolean;
}

export type SuiteCase<TValue> =
    | ValidSuiteCase<TValue>
    | InvalidSuiteCase;

export interface ValidSuiteCase<TValue> {
    readonly id: string;
    readonly kind: "valid";
    readonly index: number;
    readonly value: TValue;
}

export interface InvalidSuiteCase {
    readonly id: string;
    readonly kind: "invalid";
    readonly index: number;
    readonly value: unknown;
    readonly fuzz: FuzzCase;
}

export interface SuiteReport<TValue, TResult> {
    readonly ok: boolean;
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly results: readonly SuiteRunResult<TValue, TResult>[];
}

export interface SuiteRunResult<TValue, TResult> {
    readonly case: SuiteCase<TValue>;
    readonly ok: boolean;
    readonly output: TResult | undefined;
    readonly error: unknown;
    readonly attempts: number;
    readonly durationMs: number;
    readonly timedOut: boolean;
    readonly aborted: boolean;
    readonly shrunk: ShrinkResult | undefined;
}

interface SuitePlan {
    readonly valid: readonly SamplesOptions[];
    readonly invalid: readonly FuzzOptions[];
}

interface RunOutcome<TResult> {
    readonly output: TResult | undefined;
    readonly error: unknown;
    readonly attempts: number;
    readonly durationMs: number;
    readonly timedOut: boolean;
    readonly aborted: boolean;
}

const EMPTY_SAMPLES_OPTIONS: SamplesOptions = Object.freeze({});
const EMPTY_FUZZ_OPTIONS: FuzzOptions = Object.freeze({});
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_RETRIES = 0;

/**
 * @brief Create a new suite for a TypeSea guard.
 * @param guard TypeSea guard.
 * @returns Suite builder.
 */
export function suite<TGuard extends Guard<unknown, Presence>>(
    guard: TGuard
): Suite<Infer<TGuard>> {
    return makeSuite(guard, {
        valid: Object.freeze([]),
        invalid: Object.freeze([])
    });
}

/**
 * @brief Build an immutable suite builder.
 * @param guard TypeSea guard.
 * @param plan Suite case plan.
 * @returns Suite builder.
 */
function makeSuite<TGuard extends Guard<unknown, Presence>>(
    guard: TGuard,
    plan: SuitePlan
): Suite<Infer<TGuard>> {
    return Object.freeze({
        valid: (options?: SamplesOptions): Suite<Infer<TGuard>> =>
            makeSuite(guard, {
                valid: Object.freeze([...plan.valid, options ?? Object.freeze({})]),
                invalid: plan.invalid
            }),
        invalid: (options?: FuzzOptions): Suite<Infer<TGuard>> =>
            makeSuite(guard, {
                valid: plan.valid,
                invalid: Object.freeze([...plan.invalid, options ?? Object.freeze({})])
            }),
        against: async <TResult>(
            runner: SuiteRunner<Infer<TGuard>, TResult>,
            options?: SuiteAgainstOptions<Infer<TGuard>, TResult>
        ): Promise<SuiteReport<Infer<TGuard>, TResult>> => {
            const cases = buildCases(guard, plan);
            return runSuiteCases(cases, runner, options);
        }
    });
}

/**
 * @brief Run all suite cases with runner controls.
 * @param cases Suite cases.
 * @param runner User runner.
 * @param options Runner options.
 * @returns Suite report.
 */
async function runSuiteCases<TValue, TResult>(
    cases: readonly SuiteCase<TValue>[],
    runner: SuiteRunner<TValue, TResult>,
    options: SuiteAgainstOptions<TValue, TResult> | undefined
): Promise<SuiteReport<TValue, TResult>> {
    const runtime = normalizeRuntimeOptions(options);
    const results = new Array<SuiteRunResult<TValue, TResult>>(cases.length);
    let cursor = 0;
    let stopped = false;
    const workerCount = Math.min(runtime.concurrency, Math.max(cases.length, 1));
    const workers = new Array<Promise<void>>(workerCount);
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
        workers[workerIndex] = runWorker();
    }
    await Promise.all(workers);

    let passed = 0;
    let failed = 0;
    const compactResults: SuiteRunResult<TValue, TResult>[] = [];
    for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result === undefined) {
            continue;
        }
        compactResults.push(result);
        if (result.ok) {
            passed += 1;
        } else {
            failed += 1;
        }
    }
    return Object.freeze({
        ok: failed === 0,
        total: compactResults.length,
        passed,
        failed,
        results: Object.freeze(compactResults)
    });

    /**
     * @brief Execute one worker loop.
     */
    async function runWorker(): Promise<void> {
        while (!stopped && !isAborted(runtime.signal)) {
            const index = cursor;
            cursor += 1;
            if (index >= cases.length) {
                return;
            }
            const case_ = cases[index];
            if (case_ === undefined) {
                continue;
            }
            const result = await runSuiteCase(case_, runner, options, runtime);
            results[index] = result;
            if (!result.ok && runtime.stopOnFailure) {
                stopped = true;
            }
        }
    }
}

/**
 * @brief Build all planned suite cases.
 * @param guard TypeSea guard.
 * @param plan Suite plan.
 * @returns Suite cases.
 */
function buildCases<TGuard extends Guard<unknown, Presence>>(
    guard: TGuard,
    plan: SuitePlan
): readonly SuiteCase<Infer<TGuard>>[] {
    const cases: SuiteCase<Infer<TGuard>>[] = [];
    for (let planIndex = 0; planIndex < plan.valid.length; planIndex += 1) {
        const options = plan.valid[planIndex] ?? EMPTY_SAMPLES_OPTIONS;
        const count = options.count ?? 1;
        const seed = normalizePlanSeed(options.seed, `valid_${String(planIndex)}`);
        for (let index = 0; index < count; index += 1) {
            const value = sample(guard, validCaseOptions(options, seed, index));
            cases.push(Object.freeze({
                id: `sf:${seed}:valid:${String(index)}:sample`,
                kind: "valid",
                index,
                value
            }));
        }
    }
    for (let planIndex = 0; planIndex < plan.invalid.length; planIndex += 1) {
        const options = plan.invalid[planIndex] ?? EMPTY_FUZZ_OPTIONS;
        const seed = normalizePlanSeed(options.seed, `invalid_${String(planIndex)}`);
        for (const fuzzCase of fuzz(guard, {
            ...options,
            seed,
            count: options.count ?? 1
        })) {
            cases.push(Object.freeze({
                id: fuzzCase.id,
                kind: "invalid",
                index: fuzzCase.index,
                value: fuzzCase.value,
                fuzz: fuzzCase
            }));
        }
    }
    return Object.freeze(cases);
}

/**
 * @brief Run one suite case.
 * @param case_ Suite case.
 * @param runner User runner.
 * @param options Runner options.
 * @returns Run result.
 */
async function runSuiteCase<TValue, TResult>(
    case_: SuiteCase<TValue>,
    runner: SuiteRunner<TValue, TResult>,
    options: SuiteAgainstOptions<TValue, TResult> | undefined,
    runtime: NormalizedSuiteRuntimeOptions
): Promise<SuiteRunResult<TValue, TResult>> {
    const outcome = await callRunnerWithRetries(case_, runner, runtime);
    const predicate = await outputFailed(case_, outcome.output, options?.failWhen);
    const failed = outcome.error !== undefined || predicate.failed || predicate.error !== undefined;
    const error = outcome.error ?? predicate.error;
    const shrunk = failed && options?.shrink !== undefined && options.shrink !== false
        ? await shrinkSuiteCase(case_, runner, options)
        : undefined;
    return Object.freeze({
        case: case_,
        ok: !failed,
        output: outcome.output,
        error,
        attempts: outcome.attempts,
        durationMs: outcome.durationMs,
        timedOut: outcome.timedOut,
        aborted: outcome.aborted,
        shrunk
    });
}

/**
 * @brief Call user runner and convert thrown failures to data.
 * @param case_ Suite case.
 * @param runner User runner.
 * @returns Output or error.
 */
function callRunnerWithRetries<TValue, TResult>(
    case_: SuiteCase<TValue>,
    runner: SuiteRunner<TValue, TResult>,
    runtime: NormalizedSuiteRuntimeOptions
): Promise<RunOutcome<TResult>> {
    const started = Date.now();
    return callRunnerAttempt(case_, runner, runtime, 0, started);
}

/**
 * @brief Call one runner attempt and retry transient runner failures.
 * @param case_ Suite case.
 * @param runner User runner.
 * @param runtime Runtime controls.
 * @param attempt Current zero-based attempt.
 * @param started Start time.
 * @returns Output or error.
 */
function callRunnerAttempt<TValue, TResult>(
    case_: SuiteCase<TValue>,
    runner: SuiteRunner<TValue, TResult>,
    runtime: NormalizedSuiteRuntimeOptions,
    attempt: number,
    started: number
): Promise<RunOutcome<TResult>> {
    if (isAborted(runtime.signal)) {
        return Promise.resolve(finishRunOutcome<TResult>(
            undefined,
            new Error("suite run aborted"),
            attempt + 1,
            started,
            false,
            true
        ));
    }
    return runWithTimeout(case_, runner, runtime).then((outcome) => {
        if (outcome.error === undefined || attempt >= runtime.retries) {
            return finishRunOutcome(
                outcome.output,
                outcome.error,
                attempt + 1,
                started,
                outcome.timedOut,
                outcome.aborted
            );
        }
        return callRunnerAttempt(case_, runner, runtime, attempt + 1, started);
    });
}

/**
 * @brief Run one attempt with optional timeout.
 * @param case_ Suite case.
 * @param runner User runner.
 * @param runtime Runtime controls.
 * @returns Attempt outcome.
 */
function runWithTimeout<TValue, TResult>(
    case_: SuiteCase<TValue>,
    runner: SuiteRunner<TValue, TResult>,
    runtime: NormalizedSuiteRuntimeOptions
): Promise<RunOutcome<TResult>> {
    const runnerPromise = callRunnerOnce(case_, runner);
    if (runtime.timeoutMs === undefined) {
        return runnerPromise;
    }
    return Promise.race([
        runnerPromise,
        timeoutOutcome<TResult>(runtime.timeoutMs)
    ]);
}

/**
 * @brief Call user runner once and convert rejection to data.
 * @param case_ Suite case.
 * @param runner User runner.
 * @returns Single-attempt outcome.
 */
function callRunnerOnce<TValue, TResult>(
    case_: SuiteCase<TValue>,
    runner: SuiteRunner<TValue, TResult>
): Promise<RunOutcome<TResult>> {
    const started = Date.now();
    return new Promise<TResult>((resolve) => {
        resolve(runner(case_));
    }).then(
        (output): RunOutcome<TResult> => finishRunOutcome(
            output,
            undefined,
            1,
            started,
            false,
            false
        ),
        (error: unknown): RunOutcome<TResult> => finishRunOutcome<TResult>(
            undefined,
            error,
            1,
            started,
            false,
            false
        )
    );
}

/**
 * @brief Build a timeout outcome.
 * @param timeoutMs Timeout in milliseconds.
 * @returns Timeout outcome promise.
 */
function timeoutOutcome<TResult>(timeoutMs: number): Promise<RunOutcome<TResult>> {
    const started = Date.now();
    return new Promise<RunOutcome<TResult>>((resolve) => {
        setTimeout(() => {
            resolve(finishRunOutcome<TResult>(
                undefined,
                new Error(`suite runner timed out after ${String(timeoutMs)}ms`),
                1,
                started,
                true,
                false
            ));
        }, timeoutMs);
    });
}

/**
 * @brief Construct run outcome.
 * @param output Runner output.
 * @param error Runner error.
 * @param attempts Attempt count.
 * @param started Start timestamp.
 * @param timedOut Timeout flag.
 * @param aborted Abort flag.
 * @returns Frozen outcome.
 */
function finishRunOutcome<TResult>(
    output: TResult | undefined,
    error: unknown,
    attempts: number,
    started: number,
    timedOut: boolean,
    aborted: boolean
): RunOutcome<TResult> {
    return Object.freeze({
        output,
        error,
        attempts,
        durationMs: Math.max(0, Date.now() - started),
        timedOut,
        aborted
    });
}

interface FailedPredicateResult {
    readonly failed: boolean;
    readonly error: unknown;
}

/**
 * @brief Check user failure predicate.
 * @param case_ Suite case.
 * @param output Runner output.
 * @param failWhen Optional failure predicate.
 * @returns Failure predicate result.
 */
function outputFailed<TValue, TResult>(
    case_: SuiteCase<TValue>,
    output: TResult | undefined,
    failWhen: SuiteFailPredicate<TValue, TResult> | undefined
): Promise<FailedPredicateResult> {
    if (output === undefined || failWhen === undefined) {
        return Promise.resolve(Object.freeze({
            failed: false,
            error: undefined
        }));
    }
    return Promise.resolve(failWhen(output, case_)).then(
        (failed): FailedPredicateResult => Object.freeze({
            failed,
            error: undefined
        }),
        (error: unknown): FailedPredicateResult => Object.freeze({
            failed: true,
            error
        })
    );
}

/**
 * @brief Shrink a failing suite case.
 * @param case_ Failing suite case.
 * @param runner User runner.
 * @param options Suite options.
 * @returns Shrink result.
 */
async function shrinkSuiteCase<TValue, TResult>(
    case_: SuiteCase<TValue>,
    runner: SuiteRunner<TValue, TResult>,
    options: SuiteAgainstOptions<TValue, TResult>
): Promise<ShrinkResult> {
    return shrink(
        case_.value,
        async (value): Promise<boolean> => {
            const candidate = replaceCaseValue(case_, value);
            const runtime = normalizeRuntimeOptions(options);
            const outcome = await callRunnerWithRetries(candidate, runner, runtime);
            const predicate = await outputFailed(candidate, outcome.output, options.failWhen);
            return outcome.error !== undefined || predicate.failed || predicate.error !== undefined;
        },
        readShrinkOptions(options.shrink)
    );
}

/**
 * @brief Normalize suite shrink option.
 * @param option Suite shrink option.
 * @returns Shrink options or undefined for defaults.
 */
function readShrinkOptions(
    option: boolean | ShrinkOptions | undefined
): ShrinkOptions | undefined {
    if (option === undefined || typeof option === "boolean") {
        return undefined;
    }
    return option;
}

/**
 * @brief Replace a suite case value.
 * @param case_ Source case.
 * @param value Replacement value.
 * @returns New case with the replacement value.
 */
function replaceCaseValue<TValue>(
    case_: SuiteCase<TValue>,
    value: unknown
): SuiteCase<TValue> {
    if (case_.kind === "valid") {
        return Object.freeze({
            ...case_,
            value: value as TValue
        });
    }
    return Object.freeze({
        ...case_,
        value
    });
}

/**
 * @brief Build valid sample options for a suite case.
 * @param options Source options.
 * @param seed Suite seed.
 * @param index Case index.
 * @returns Generation options.
 */
function validCaseOptions(
    options: SamplesOptions,
    seed: string,
    index: number
): GenerationOptions {
    let next: GenerationOptions = {
        seed: `${seed}:${String(index)}`
    };
    if (options.depth !== undefined) {
        next = {
            ...next,
            depth: options.depth
        };
    }
    if (options.maxArrayLength !== undefined) {
        next = {
            ...next,
            maxArrayLength: options.maxArrayLength
        };
    }
    if (options.maxRetries !== undefined) {
        next = {
            ...next,
            maxRetries: options.maxRetries
        };
    }
    if (options.profile !== undefined) {
        next = {
            ...next,
            profile: options.profile
        };
    }
    if (options.overrides !== undefined) {
        next = {
            ...next,
            overrides: options.overrides
        };
    }
    return next;
}

/**
 * @brief Normalize plan seed.
 * @param seed Candidate seed.
 * @param fallback Fallback seed.
 * @returns String seed.
 */
function normalizePlanSeed(
    seed: string | number | undefined,
    fallback: string
): string {
    if (seed === undefined) {
        return fallback;
    }
    return String(seed);
}

interface NormalizedSuiteRuntimeOptions {
    readonly concurrency: number;
    readonly timeoutMs: number | undefined;
    readonly retries: number;
    readonly signal: AbortSignal | undefined;
    readonly stopOnFailure: boolean;
}

/**
 * @brief Normalize suite runtime controls.
 * @param options Caller options.
 * @returns Runtime controls.
 */
function normalizeRuntimeOptions<TValue, TResult>(
    options: SuiteAgainstOptions<TValue, TResult> | undefined
): NormalizedSuiteRuntimeOptions {
    return Object.freeze({
        concurrency: readPositiveInteger(options?.concurrency, DEFAULT_CONCURRENCY, "concurrency"),
        timeoutMs: readOptionalPositiveInteger(options?.timeoutMs, "timeoutMs"),
        retries: readNonNegativeInteger(options?.retries, DEFAULT_RETRIES, "retries"),
        signal: options?.signal,
        stopOnFailure: options?.stopOnFailure ?? false
    });
}

/**
 * @brief Read positive integer with fallback.
 * @param value Candidate value.
 * @param fallback Fallback value.
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
 * @brief Read optional positive integer.
 * @param value Candidate value.
 * @param label Option label.
 * @returns Normalized integer or undefined.
 */
function readOptionalPositiveInteger(
    value: number | undefined,
    label: string
): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    return readPositiveInteger(value, 1, label);
}

/**
 * @brief Read non-negative integer with fallback.
 * @param value Candidate value.
 * @param fallback Fallback value.
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
 * @brief Check abort signal state.
 * @param signal Abort signal.
 * @returns True when aborted.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
    return signal?.aborted ?? false;
}
