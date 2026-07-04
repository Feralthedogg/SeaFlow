/**
 * @file types.ts
 * @brief Public generation and fuzzing option contracts.
 * @details Valid generation returns TypeSea-inferred values; invalid fuzzing returns
 * unknown payloads with reproducibility metadata.
 */

import type { PathSegment } from "../contract/node.js";
import type { Rng } from "../rng/index.js";
import type { PayloadPackName } from "../payloads/index.js";

export interface BaseGenerationOptions {
    readonly seed?: string | number;
    readonly depth?: number;
    readonly maxArrayLength?: number;
    readonly maxRetries?: number;
}

export interface GenerationOptions extends BaseGenerationOptions {
    readonly profile?: GenerationProfile;
    readonly overrides?: Overrides;
}

export type GenerationProfile =
    | "typical"
    | "boundary"
    | "wide";

export interface SamplesOptions extends GenerationOptions {
    readonly count?: number;
}

export interface FuzzOptions extends BaseGenerationOptions {
    readonly count?: number;
    readonly mode?: "invalid" | "mixed";
    readonly profile?: FuzzProfile;
    readonly domain?: FuzzDomain;
    readonly targets?: readonly FuzzTarget[];
    readonly packs?: readonly PayloadPackName[];
}

export type FuzzProfile =
    | "boundary"
    | "type-confusion"
    | "presence"
    | "security";

export type FuzzDomain =
    | "json"
    | "javascript"
    | "hostile-js";

export interface FuzzCase {
    readonly id: string;
    readonly seed: string;
    readonly index: number;
    readonly value: unknown;
    readonly valid: boolean;
    readonly strategy: string;
    readonly path: readonly PathSegment[];
    readonly reason: string;
    readonly issues?: readonly unknown[];
}

export type Overrides =
    | OverrideMap
    | readonly OverrideRule[];

export type OverrideMap = Readonly<Record<string, OverrideMapValue>>;

export type OverrideMapValue =
    | OverrideFunction
    | OverrideLiteral
    | string
    | number
    | bigint
    | boolean
    | symbol
    | null
    | undefined
    | readonly unknown[]
    | Readonly<Record<string, unknown>>;

export type OverrideFunction = (context: OverrideContext) => unknown;

export interface OverrideContext {
    readonly path: readonly PathSegment[];
    readonly seed: string;
    readonly rng: Rng;
}

export interface OverrideLiteral {
    readonly value: unknown;
}

export interface OverrideRule {
    readonly path: readonly PathSegment[];
    readonly value: OverrideMapValue;
}

export interface NormalizedOverrideRule {
    readonly path: readonly PathSegment[];
    readonly source: unknown;
}

export interface FuzzTarget {
    readonly path: readonly PathSegment[];
    readonly values?: readonly unknown[];
    readonly packs?: readonly PayloadPackName[];
    readonly strategy?: string;
    readonly reason?: string;
}

export interface NormalizedFuzzTarget {
    readonly path: readonly PathSegment[];
    readonly values: readonly unknown[];
    readonly packs: readonly PayloadPackName[];
    readonly strategy: string | undefined;
    readonly reason: string | undefined;
}

export interface NormalizedGenerationOptions {
    readonly seed: string;
    readonly depth: number;
    readonly maxArrayLength: number;
    readonly maxRetries: number;
    readonly profile: GenerationProfile;
    readonly overrides: readonly NormalizedOverrideRule[];
}

export interface NormalizedFuzzOptions {
    readonly seed: string;
    readonly depth: number;
    readonly maxArrayLength: number;
    readonly maxRetries: number;
    readonly count: number;
    readonly mode: "invalid" | "mixed";
    readonly profile: FuzzProfile;
    readonly domain: FuzzDomain;
    readonly targets: readonly NormalizedFuzzTarget[];
    readonly packs: readonly PayloadPackName[];
}
