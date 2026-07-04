/**
 * @file index.ts
 * @brief User-supplied payload inspection.
 * @details Inspection does not generate data. It runs caller-provided payloads through
 * the TypeSea oracle and returns immutable case results.
 */

import type {
    Guard,
    Infer,
    Presence
} from "typesea";

export interface InspectInput {
    readonly id?: string;
    readonly value: unknown;
}

export interface InspectionReport<TValue> {
    readonly ok: boolean;
    readonly total: number;
    readonly valid: number;
    readonly invalid: number;
    readonly cases: readonly InspectionCase<TValue>[];
}

export type InspectionCase<TValue> =
    | ValidInspectionCase<TValue>
    | InvalidInspectionCase;

export interface ValidInspectionCase<TValue> {
    readonly id: string;
    readonly index: number;
    readonly valid: true;
    readonly value: TValue;
}

export interface InvalidInspectionCase {
    readonly id: string;
    readonly index: number;
    readonly valid: false;
    readonly value: unknown;
    readonly issues: readonly unknown[];
}

/**
 * @brief Inspect caller-provided payloads with a TypeSea guard.
 * @param guard TypeSea guard used as the oracle.
 * @param inputs Payloads to inspect.
 * @returns Frozen inspection report.
 */
export function inspect<TGuard extends Guard<unknown, Presence>>(
    guard: TGuard,
    inputs: readonly InspectInput[]
): InspectionReport<Infer<TGuard>> {
    const cases = new Array<InspectionCase<Infer<TGuard>>>(inputs.length);
    let valid = 0;
    let invalid = 0;
    for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        if (input === undefined) {
            continue;
        }
        const id = input.id ?? `case_${String(index)}`;
        const result = guard.check(input.value);
        if (result.ok) {
            valid += 1;
            cases[index] = Object.freeze({
                id,
                index,
                valid: true,
                value: result.value as Infer<TGuard>
            });
            continue;
        }
        invalid += 1;
        cases[index] = Object.freeze({
            id,
            index,
            valid: false,
            value: input.value,
            issues: Object.freeze([...result.error])
        });
    }
    return Object.freeze({
        ok: invalid === 0,
        total: cases.length,
        valid,
        invalid,
        cases: Object.freeze(cases)
    });
}

