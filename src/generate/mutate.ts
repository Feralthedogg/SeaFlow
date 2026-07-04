/**
 * @file mutate.ts
 * @brief Invalid payload mutation.
 * @details Mutations are intentionally best-effort and are accepted publicly only when
 * TypeSea rejects the final payload.
 */

import type {
    Contract,
    ContractNode,
    ContractObjectEntry,
    PathSegment
} from "../contract/node.js";
import { isRecord } from "../internal/index.js";
import type { Rng } from "../rng/index.js";
import type { FuzzDomain } from "./types.js";

export interface MutationCandidate {
    readonly value: unknown;
    readonly strategy: string;
    readonly path: readonly PathSegment[];
    readonly reason: string;
}

/**
 * @brief Mutate a generated valid value into an invalid candidate.
 * @param contract Contract graph.
 * @param value Valid base value.
 * @param rng Deterministic random source.
 * @param domain Payload domain.
 * @returns Mutation candidate.
 */
export function mutateInvalid(
    contract: Contract,
    value: unknown,
    rng: Rng,
    domain: FuzzDomain
): MutationCandidate {
    return mutateNode(contract.root, contract, value, rng, domain, [], 0);
}

/**
 * @brief Mutate one node.
 * @param node Contract node.
 * @param contract Contract graph.
 * @param value Value at the node.
 * @param rng Deterministic random source.
 * @param domain Payload domain.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Mutation candidate.
 */
function mutateNode(
    node: ContractNode,
    contract: Contract,
    value: unknown,
    rng: Rng,
    domain: FuzzDomain,
    path: readonly PathSegment[],
    depth: number
): MutationCandidate {
    switch (node.kind) {
        case "unknown":
            return poison(value, "unknown.poison", path, domain);
        case "never":
            return Object.freeze({
                value: null,
                strategy: "never.any",
                path,
                reason: "never accepts no runtime value"
            });
        case "string":
            return mutateString(node, path, domain);
        case "number":
            return mutateNumber(node, path, domain);
        case "bigint":
            return Object.freeze({
                value: 1,
                strategy: "bigint.type",
                path,
                reason: "number is not bigint"
            });
        case "symbol":
            return Object.freeze({
                value: "symbol",
                strategy: "symbol.type",
                path,
                reason: "string is not symbol"
            });
        case "boolean":
            return Object.freeze({
                value: "true",
                strategy: "boolean.type",
                path,
                reason: "string is not boolean"
            });
        case "literal":
            return Object.freeze({
                value: literalMiss(node.value, domain),
                strategy: "literal.mismatch",
                path,
                reason: "value does not match literal"
            });
        case "array":
            return mutateArray(node.item, contract, value, rng, domain, path, depth);
        case "tuple":
            return mutateTuple(node.items, value, path);
        case "record":
            return mutateRecord(node.value, contract, value, rng, domain, path, depth);
        case "object":
            return mutateObject(node.entries, node.mode, contract, value, rng, domain, path, depth);
        case "union":
            return Object.freeze({
                value: unionMiss(domain),
                strategy: "union.mismatch",
                path,
                reason: "payload should miss every union branch"
            });
        case "intersection":
            return mutateNode(node.left, contract, value, rng, domain, path, depth);
        case "optional":
            return mutateNode(node.inner, contract, value, rng, domain, path, depth);
        case "nullable":
            return mutateNode(node.inner, contract, value, rng, domain, path, depth);
        case "undefinedable":
            return mutateNode(node.inner, contract, value, rng, domain, path, depth);
        case "reference":
            return mutateReference(node.refId, contract, value, rng, domain, path, depth);
        case "opaque":
            if (node.inner !== undefined) {
                return mutateNode(node.inner, contract, value, rng, domain, path, depth);
            }
            return poison(value, "opaque.poison", path, domain);
    }
}

/**
 * @brief Mutate a string.
 * @param node String contract.
 * @param path Current path.
 * @param domain Payload domain.
 * @returns Mutation candidate.
 */
function mutateString(
    node: Extract<ContractNode, { readonly kind: "string" }>,
    path: readonly PathSegment[],
    domain: FuzzDomain
): MutationCandidate {
    if (node.format === "uuid") {
        return Object.freeze({
            value: "not-a-uuid",
            strategy: "string.uuid",
            path,
            reason: "uuid format is invalid"
        });
    }
    if (node.min !== undefined && node.min > 0) {
        return Object.freeze({
            value: "",
            strategy: "string.min.underflow",
            path,
            reason: "string is shorter than min"
        });
    }
    if (node.max !== undefined) {
        return Object.freeze({
            value: "x".repeat(node.max + 1),
            strategy: "string.max.overflow",
            path,
            reason: "string is longer than max"
        });
    }
    return poison("", "string.type", path, domain);
}

/**
 * @brief Mutate a number.
 * @param node Number contract.
 * @param path Current path.
 * @param domain Payload domain.
 * @returns Mutation candidate.
 */
function mutateNumber(
    node: Extract<ContractNode, { readonly kind: "number" }>,
    path: readonly PathSegment[],
    domain: FuzzDomain
): MutationCandidate {
    if (node.gte !== undefined) {
        return Object.freeze({
            value: node.gte - 1,
            strategy: "number.gte.underflow",
            path,
            reason: "number is below lower bound"
        });
    }
    if (node.lte !== undefined) {
        return Object.freeze({
            value: node.lte + 1,
            strategy: "number.lte.overflow",
            path,
            reason: "number is above upper bound"
        });
    }
    if (node.int) {
        return Object.freeze({
            value: 0.5,
            strategy: "number.integer",
            path,
            reason: "number is not an integer"
        });
    }
    return poison(0, "number.type", path, domain);
}

/**
 * @brief Mutate an array.
 * @param item Item node.
 * @param contract Contract graph.
 * @param value Array value.
 * @param rng Deterministic random source.
 * @param domain Payload domain.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Mutation candidate.
 */
function mutateArray(
    item: ContractNode,
    contract: Contract,
    value: unknown,
    rng: Rng,
    domain: FuzzDomain,
    path: readonly PathSegment[],
    depth: number
): MutationCandidate {
    if (isUnknownArray(value) && value.length > 0) {
        const mutated = [...value];
        const child = mutateNode(item, contract, value[0], rng, domain, [...path, 0], depth + 1);
        mutated[0] = child.value;
        return Object.freeze({
            value: mutated,
            strategy: child.strategy,
            path: child.path,
            reason: child.reason
        });
    }
    return Object.freeze({
        value: {},
        strategy: "array.type",
        path,
        reason: "object is not array"
    });
}

/**
 * @brief Mutate a tuple.
 * @param items Tuple item nodes.
 * @param value Tuple value.
 * @param path Current path.
 * @returns Mutation candidate.
 */
function mutateTuple(
    items: readonly ContractNode[],
    value: unknown,
    path: readonly PathSegment[]
): MutationCandidate {
    if (Array.isArray(value) && value.length === items.length) {
        return Object.freeze({
            value: value.slice(0, Math.max(0, value.length - 1)),
            strategy: "tuple.length",
            path,
            reason: "tuple length is wrong"
        });
    }
    return Object.freeze({
        value: [],
        strategy: "tuple.length",
        path,
        reason: "tuple length is wrong"
    });
}

/**
 * @brief Mutate a record value.
 * @param item Record item node.
 * @param contract Contract graph.
 * @param value Record value.
 * @param rng Deterministic random source.
 * @param domain Payload domain.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Mutation candidate.
 */
function mutateRecord(
    item: ContractNode,
    contract: Contract,
    value: unknown,
    rng: Rng,
    domain: FuzzDomain,
    path: readonly PathSegment[],
    depth: number
): MutationCandidate {
    if (!isRecord(value)) {
        return Object.freeze({
            value: [],
            strategy: "record.type",
            path,
            reason: "array is not record object"
        });
    }
    const keys = Object.keys(value);
    if (keys.length === 0) {
        return Object.freeze({
            value: [],
            strategy: "record.type",
            path,
            reason: "array is not record object"
        });
    }
    const key = keys[0] ?? "";
    const child = mutateNode(item, contract, value[key], rng, domain, [...path, key], depth + 1);
    return Object.freeze({
        value: {
            ...value,
            [key]: child.value
        },
        strategy: child.strategy,
        path: child.path,
        reason: child.reason
    });
}

/**
 * @brief Mutate an object value.
 * @param entries Object entries.
 * @param mode Object strictness mode.
 * @param contract Contract graph.
 * @param value Object value.
 * @param rng Deterministic random source.
 * @param domain Payload domain.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Mutation candidate.
 */
function mutateObject(
    entries: readonly ContractObjectEntry[],
    mode: "passthrough" | "strict",
    contract: Contract,
    value: unknown,
    rng: Rng,
    domain: FuzzDomain,
    path: readonly PathSegment[],
    depth: number
): MutationCandidate {
    if (!isRecord(value)) {
        return Object.freeze({
            value: [],
            strategy: "object.type",
            path,
            reason: "array is not object"
        });
    }
    if (domain === "hostile-js" && mode === "strict") {
        return hostileStrictObject(value, path);
    }
    const required = firstRequiredEntry(entries);
    if (required !== undefined) {
        const copy = copyWithoutKey(value, required.key);
        return Object.freeze({
            value: copy,
            strategy: "object.required",
            path: [...path, required.key],
            reason: "required key is missing"
        });
    }
    if (mode === "strict") {
        return Object.freeze({
            value: {
                ...value,
                __seaflow_extra: true
            },
            strategy: "object.strict.extra",
            path: [...path, "__seaflow_extra"],
            reason: "strict object has an extra key"
        });
    }
    const entry = entries[0];
    if (entry !== undefined) {
        const child = mutateNode(
            entry.node,
            contract,
            value[entry.key],
            rng,
            domain,
            [...path, entry.key],
            depth + 1
        );
        return Object.freeze({
            value: {
                ...value,
                [entry.key]: child.value
            },
            strategy: child.strategy,
            path: child.path,
            reason: child.reason
        });
    }
    return poison(value, "object.poison", path, domain);
}

/**
 * @brief Mutate a reference target.
 * @param refId Definition id.
 * @param contract Contract graph.
 * @param value Reference value.
 * @param rng Deterministic random source.
 * @param domain Payload domain.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Mutation candidate.
 */
function mutateReference(
    refId: string,
    contract: Contract,
    value: unknown,
    rng: Rng,
    domain: FuzzDomain,
    path: readonly PathSegment[],
    depth: number
): MutationCandidate {
    const definition = contract.definitions.get(refId);
    if (definition === undefined) {
        return poison(value, "reference.missing", path, domain);
    }
    return mutateNode(definition, contract, value, rng, domain, path, depth + 1);
}

/**
 * @brief Find first required object entry.
 * @param entries Object entries.
 * @returns Required entry or undefined.
 */
function firstRequiredEntry(
    entries: readonly ContractObjectEntry[]
): ContractObjectEntry | undefined {
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry?.presence === "required") {
            return entry;
        }
    }
    return undefined;
}

/**
 * @brief Accept unknown arrays without widening elements.
 * @param value Candidate value.
 * @returns True when value is an array.
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

/**
 * @brief Copy an object while omitting one key.
 * @param value Source object.
 * @param omitted Omitted key.
 * @returns New record without the omitted key.
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
 * @brief Create a strict-object hostile JS mutation.
 * @param value Base value.
 * @param path Current path.
 * @returns Mutation candidate.
 */
function hostileStrictObject(
    value: Readonly<Record<string, unknown>>,
    path: readonly PathSegment[]
): MutationCandidate {
    const copy: Record<string, unknown> = {
        ...value
    };
    Object.defineProperty(copy, "__seaflow_accessor", {
        configurable: true,
        enumerable: true,
        get: (): unknown => "getter-ran"
    });
    return Object.freeze({
        value: copy,
        strategy: "object.strict.accessor",
        path: [...path, "__seaflow_accessor"],
        reason: "strict object has an accessor extra key"
    });
}

/**
 * @brief Produce a broadly wrong value.
 * @param value Current valid value.
 * @param strategy Strategy label.
 * @param path Current path.
 * @param domain Payload domain.
 * @returns Mutation candidate.
 */
function poison(
    value: unknown,
    strategy: string,
    path: readonly PathSegment[],
    domain: FuzzDomain
): MutationCandidate {
    if (domain === "javascript" || domain === "hostile-js") {
        return Object.freeze({
            value: Number.NaN,
            strategy,
            path,
            reason: "NaN should confuse the value domain"
        });
    }
    return Object.freeze({
        value: value === null ? false : null,
        strategy,
        path,
        reason: "null should confuse the value domain"
    });
}

/**
 * @brief Produce a literal mismatch.
 * @param value Literal value.
 * @param domain Payload domain.
 * @returns Mismatched value.
 */
function literalMiss(value: unknown, domain: FuzzDomain): unknown {
    if (typeof value === "string") {
        return `${value}_miss`;
    }
    if (typeof value === "number") {
        return value + 1;
    }
    if (typeof value === "boolean") {
        return !value;
    }
    if (value === null) {
        return false;
    }
    if (domain === "javascript" || domain === "hostile-js") {
        return Symbol("literal_miss");
    }
    return "__seaflow_literal_miss";
}

/**
 * @brief Produce a value that should miss ordinary union branches.
 * @param domain Payload domain.
 * @returns Union miss candidate.
 */
function unionMiss(domain: FuzzDomain): unknown {
    if (domain === "javascript" || domain === "hostile-js") {
        return Symbol("union_miss");
    }
    return {
        __seaflow_union_miss: true
    };
}
