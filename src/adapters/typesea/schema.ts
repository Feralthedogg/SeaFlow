/**
 * @file schema.ts
 * @brief TypeSea schema normalization.
 * @details TypeSea remains the oracle; this adapter only translates schema structure
 * into SeaFlow's generator-oriented contract graph.
 */

import type {
    Guard,
    Presence,
    Schema
} from "typesea";
import type {
    Contract,
    ContractNode,
    ContractObjectEntry,
    NumberContractNode,
    RegexConstraint,
    StringContractNode
} from "../../contract/node.js";
import {
    NumberCheckTag,
    ObjectModeTag,
    PresenceTag,
    SchemaTag,
    StringCheckTag
} from "./tags.js";

interface NormalizeContext {
    readonly definitions: Map<string, ContractNode>;
    readonly refs: WeakMap<object, string>;
    nextRef: number;
}

/**
 * @brief Normalize a TypeSea guard into a SeaFlow contract.
 * @param guard TypeSea guard.
 * @returns SeaFlow contract graph.
 */
export function contractFromGuard(
    guard: Guard<unknown, Presence>
): Contract {
    return contractFromSchema(guard.schema);
}

/**
 * @brief Normalize a TypeSea schema into a SeaFlow contract.
 * @param schema TypeSea schema.
 * @returns SeaFlow contract graph.
 */
export function contractFromSchema(schema: Schema): Contract {
    const context: NormalizeContext = {
        definitions: new Map<string, ContractNode>(),
        refs: new WeakMap<object, string>(),
        nextRef: 0
    };
    const contract: Contract = {
        root: normalizeSchema(schema, context),
        definitions: context.definitions
    };
    return Object.freeze(contract);
}

/**
 * @brief Normalize one TypeSea schema node.
 * @param schema Source TypeSea schema.
 * @param context Mutable normalization context.
 * @returns SeaFlow contract node.
 */
function normalizeSchema(
    schema: Schema,
    context: NormalizeContext
): ContractNode {
    switch (schema.tag) {
        case SchemaTag.Unknown:
            return Object.freeze({
                kind: "unknown"
            });
        case SchemaTag.Never:
            return Object.freeze({
                kind: "never"
            });
        case SchemaTag.String:
            return normalizeStringSchema(schema);
        case SchemaTag.Number:
            return normalizeNumberSchema(schema);
        case SchemaTag.BigInt:
            return Object.freeze({
                kind: "bigint"
            });
        case SchemaTag.Symbol:
            return Object.freeze({
                kind: "symbol"
            });
        case SchemaTag.Boolean:
            return Object.freeze({
                kind: "boolean"
            });
        case SchemaTag.Literal:
            return Object.freeze({
                kind: "literal",
                value: schema.value
            });
        case SchemaTag.Array:
            return Object.freeze({
                kind: "array",
                item: normalizeSchema(schema.item, context)
            });
        case SchemaTag.Tuple:
            return Object.freeze({
                kind: "tuple",
                items: Object.freeze(schema.items.map((item) =>
                    normalizeSchema(item, context)
                ))
            });
        case SchemaTag.Record:
            return Object.freeze({
                kind: "record",
                value: normalizeSchema(schema.value, context)
            });
        case SchemaTag.Object:
            return normalizeObjectSchema(schema, context);
        case SchemaTag.Union:
            return Object.freeze({
                kind: "union",
                options: Object.freeze(schema.options.map((option) =>
                    normalizeSchema(option, context)
                ))
            });
        case SchemaTag.Intersection:
            return Object.freeze({
                kind: "intersection",
                left: normalizeSchema(schema.left, context),
                right: normalizeSchema(schema.right, context)
            });
        case SchemaTag.Optional:
            return Object.freeze({
                kind: "optional",
                inner: normalizeSchema(schema.inner, context)
            });
        case SchemaTag.Undefinedable:
            return Object.freeze({
                kind: "undefinedable",
                inner: normalizeSchema(schema.inner, context)
            });
        case SchemaTag.Nullable:
            return Object.freeze({
                kind: "nullable",
                inner: normalizeSchema(schema.inner, context)
            });
        case SchemaTag.DiscriminatedUnion:
            return Object.freeze({
                kind: "union",
                options: Object.freeze(schema.cases.map((caseSchema) =>
                    normalizeSchema(caseSchema.schema, context)
                ))
            });
        case SchemaTag.Brand:
            return normalizeSchema(schema.inner, context);
        case SchemaTag.Lazy:
            return normalizeLazySchema(schema, context);
        case SchemaTag.Refine:
            return Object.freeze({
                kind: "opaque",
                label: schema.name,
                inner: normalizeSchema(schema.inner, context)
            });
    }
}

/**
 * @brief Normalize a string schema.
 * @param schema TypeSea string schema.
 * @returns String contract node.
 */
function normalizeStringSchema(
    schema: Extract<Schema, { readonly tag: typeof SchemaTag.String }>
): StringContractNode {
    let min: number | undefined;
    let max: number | undefined;
    let format: "uuid" | undefined;
    const regex: RegexConstraint[] = [];
    for (let index = 0; index < schema.checks.length; index += 1) {
        const check = schema.checks[index];
        if (check === undefined) {
            continue;
        }
        switch (check.tag) {
            case StringCheckTag.Min:
                min = min === undefined ? check.value : Math.max(min, check.value);
                break;
            case StringCheckTag.Max:
                max = max === undefined ? check.value : Math.min(max, check.value);
                break;
            case StringCheckTag.Regex:
                regex.push({
                    source: check.regex.source,
                    flags: check.regex.flags,
                    name: check.name
                });
                break;
            case StringCheckTag.Uuid:
                format = "uuid";
                break;
        }
    }
    return Object.freeze({
        kind: "string",
        min,
        max,
        format,
        regex: Object.freeze(regex)
    });
}

/**
 * @brief Normalize a number schema.
 * @param schema TypeSea number schema.
 * @returns Number contract node.
 */
function normalizeNumberSchema(
    schema: Extract<Schema, { readonly tag: typeof SchemaTag.Number }>
): NumberContractNode {
    let int = false;
    let gte: number | undefined;
    let lte: number | undefined;
    for (let index = 0; index < schema.checks.length; index += 1) {
        const check = schema.checks[index];
        if (check === undefined) {
            continue;
        }
        switch (check.tag) {
            case NumberCheckTag.Integer:
                int = true;
                break;
            case NumberCheckTag.Gte:
                gte = gte === undefined ? check.value : Math.max(gte, check.value);
                break;
            case NumberCheckTag.Lte:
                lte = lte === undefined ? check.value : Math.min(lte, check.value);
                break;
        }
    }
    return Object.freeze({
        kind: "number",
        int,
        gte,
        lte
    });
}

/**
 * @brief Normalize an object schema.
 * @param schema TypeSea object schema.
 * @param context Mutable normalization context.
 * @returns Object contract node.
 */
function normalizeObjectSchema(
    schema: Extract<Schema, { readonly tag: typeof SchemaTag.Object }>,
    context: NormalizeContext
): ContractNode {
    const entries = new Array<ContractObjectEntry>(schema.entries.length);
    for (let index = 0; index < schema.entries.length; index += 1) {
        const entry = schema.entries[index];
        if (entry === undefined) {
            continue;
        }
        entries[index] = {
            key: entry.key,
            node: normalizeSchema(entry.schema, context),
            presence: entry.presence === PresenceTag.Optional
                ? "optional"
                : "required"
        };
    }
    return Object.freeze({
        kind: "object",
        mode: schema.mode === ObjectModeTag.Strict ? "strict" : "passthrough",
        entries: Object.freeze(entries)
    });
}

/**
 * @brief Normalize a lazy schema into a stable reference.
 * @param schema TypeSea lazy schema.
 * @param context Mutable normalization context.
 * @returns Reference contract node.
 */
function normalizeLazySchema(
    schema: Extract<Schema, { readonly tag: typeof SchemaTag.Lazy }>,
    context: NormalizeContext
): ContractNode {
    const existing = context.refs.get(schema);
    if (existing !== undefined) {
        return Object.freeze({
            kind: "reference",
            refId: existing
        });
    }
    const refId = `ref_${String(context.nextRef)}`;
    context.nextRef += 1;
    context.refs.set(schema, refId);
    const target = normalizeSchema(schema.get(), context);
    context.definitions.set(refId, target);
    return Object.freeze({
        kind: "reference",
        refId
    });
}
