/**
 * @file valid.ts
 * @brief Valid value generation from normalized contracts.
 * @details Generated values are still checked by TypeSea before public APIs return them.
 */

import type {
    Contract,
    ContractNode,
    ContractObjectEntry,
    PathSegment
} from "../contract/node.js";
import { GenerationError } from "../errors/index.js";
import type { Rng } from "../rng/index.js";
import type { NormalizedGenerationOptions } from "./types.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * @brief Generate a value intended to satisfy the supplied contract.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @returns Candidate value.
 */
export function generateValidValue(
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng
): unknown {
    return generateNode(contract.root, contract, options, rng, [], 0);
}

/**
 * @brief Generate one node.
 * @param node Contract node.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current recursive depth.
 * @returns Candidate value.
 */
function generateNode(
    node: ContractNode,
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): unknown {
    switch (node.kind) {
        case "unknown":
            return generateUnknown(rng);
        case "never":
            throw new GenerationError("never has no valid values", {
                seed: options.seed,
                path,
                strategy: "valid.never",
                retries: 0,
                label: "never"
            });
        case "string":
            return generateString(node, rng);
        case "number":
            return generateNumber(node, rng);
        case "bigint":
            return BigInt(rng.integer(0, 1000));
        case "symbol":
            return Symbol(`seaflow:${String(rng.integer(0, 1000))}`);
        case "boolean":
            return rng.boolean(0.5);
        case "literal":
            return node.value;
        case "array":
            return generateArray(node.item, contract, options, rng, path, depth);
        case "tuple":
            return generateTuple(node.items, contract, options, rng, path, depth);
        case "record":
            return generateRecord(node.value, contract, options, rng, path, depth);
        case "object":
            return generateObject(node.entries, contract, options, rng, path, depth);
        case "union":
            return generateUnion(node.options, contract, options, rng, path, depth);
        case "intersection":
            return generateIntersection(node.left, node.right, contract, options, rng, path, depth);
        case "optional":
            return rng.boolean(0.2)
                ? undefined
                : generateNode(node.inner, contract, options, rng, path, depth);
        case "nullable":
            return rng.boolean(0.2)
                ? null
                : generateNode(node.inner, contract, options, rng, path, depth);
        case "undefinedable":
            return rng.boolean(0.2)
                ? undefined
                : generateNode(node.inner, contract, options, rng, path, depth);
        case "reference":
            return generateReference(node.refId, contract, options, rng, path, depth);
        case "opaque":
            if (node.inner !== undefined) {
                return generateNode(node.inner, contract, options, rng, path, depth);
            }
            return generateUnknown(rng);
    }
}

/**
 * @brief Generate a broad unknown value.
 * @param rng Deterministic random source.
 * @returns Candidate value.
 */
function generateUnknown(rng: Rng): unknown {
    switch (rng.integer(0, 5)) {
        case 0:
            return null;
        case 1:
            return rng.boolean(0.5);
        case 2:
            return rng.integer(-10, 10);
        case 3:
            return generateBoundedString(1, 8, rng);
        case 4:
            return [];
        default:
            return {};
    }
}

/**
 * @brief Generate a string value.
 * @param node String contract.
 * @param rng Deterministic random source.
 * @returns Candidate string.
 */
function generateString(
    node: Extract<ContractNode, { readonly kind: "string" }>,
    rng: Rng
): string {
    if (node.format === "uuid") {
        return generateUuid(rng);
    }
    const min = node.min ?? 0;
    const hardMax = node.max ?? Math.max(min + 8, 8);
    const max = Math.max(min, hardMax);
    return generateBoundedString(min, max, rng);
}

/**
 * @brief Generate a number value.
 * @param node Number contract.
 * @param rng Deterministic random source.
 * @returns Candidate number.
 */
function generateNumber(
    node: Extract<ContractNode, { readonly kind: "number" }>,
    rng: Rng
): number {
    const min = Math.ceil(node.gte ?? -100);
    const max = Math.floor(node.lte ?? 100);
    if (max < min) {
        return min;
    }
    if (node.int) {
        return rng.integer(min, max);
    }
    const value = min + rng.next() * (max - min);
    return Number.isInteger(value) ? value + 0.5 : value;
}

/**
 * @brief Generate an array value.
 * @param item Item node.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Candidate array.
 */
function generateArray(
    item: ContractNode,
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): unknown[] {
    const length = depth >= options.depth
        ? 0
        : rng.integer(0, options.maxArrayLength);
    const values = new Array<unknown>(length);
    for (let index = 0; index < length; index += 1) {
        values[index] = generateNode(
            item,
            contract,
            options,
            rng.fork(`array:${String(index)}`),
            [...path, index],
            depth + 1
        );
    }
    return values;
}

/**
 * @brief Generate a tuple value.
 * @param items Tuple item nodes.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Candidate tuple array.
 */
function generateTuple(
    items: readonly ContractNode[],
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): unknown[] {
    const values = new Array<unknown>(items.length);
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item !== undefined) {
            values[index] = generateNode(
                item,
                contract,
                options,
                rng.fork(`tuple:${String(index)}`),
                [...path, index],
                depth + 1
            );
        }
    }
    return values;
}

/**
 * @brief Generate a record value.
 * @param value Value node.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Candidate object.
 */
function generateRecord(
    value: ContractNode,
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): Record<string, unknown> {
    const count = depth >= options.depth
        ? 0
        : rng.integer(0, Math.max(0, options.maxArrayLength));
    const record: Record<string, unknown> = {};
    for (let index = 0; index < count; index += 1) {
        const key = `key_${String(index)}`;
        record[key] = generateNode(
            value,
            contract,
            options,
            rng.fork(`record:${key}`),
            [...path, key],
            depth + 1
        );
    }
    return record;
}

/**
 * @brief Generate an object value.
 * @param entries Object entries.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Candidate object.
 */
function generateObject(
    entries: readonly ContractObjectEntry[],
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): Record<string, unknown> {
    const value: Record<string, unknown> = {};
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry === undefined) {
            continue;
        }
        if (entry.presence === "optional" && rng.boolean(0.35)) {
            continue;
        }
        value[entry.key] = generateNode(
            entry.node,
            contract,
            options,
            rng.fork(`object:${entry.key}`),
            [...path, entry.key],
            depth + 1
        );
    }
    return value;
}

/**
 * @brief Generate a union branch.
 * @param optionsNodes Union options.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Candidate value.
 */
function generateUnion(
    optionsNodes: readonly ContractNode[],
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): unknown {
    if (optionsNodes.length === 0) {
        throw new GenerationError("empty union has no valid values", {
            seed: options.seed,
            path,
            strategy: "valid.union.empty",
            retries: 0,
            label: "union"
        });
    }
    const offset = rng.pickIndex(optionsNodes.length);
    const node = optionsNodes[offset];
    if (node === undefined) {
        throw new GenerationError("union option disappeared", {
            seed: options.seed,
            path,
            strategy: "valid.union.missing",
            retries: 0,
            label: "union"
        });
    }
    return generateNode(node, contract, options, rng.fork(`union:${String(offset)}`), path, depth);
}

/**
 * @brief Generate an intersection value.
 * @param left Left contract.
 * @param right Right contract.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Candidate value.
 */
function generateIntersection(
    left: ContractNode,
    right: ContractNode,
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): unknown {
    const leftValue = generateNode(left, contract, options, rng.fork("left"), path, depth);
    const rightValue = generateNode(right, contract, options, rng.fork("right"), path, depth);
    if (isPlainRecord(leftValue) && isPlainRecord(rightValue)) {
        return {
            ...leftValue,
            ...rightValue
        };
    }
    return leftValue;
}

/**
 * @brief Generate a recursive reference.
 * @param refId Definition id.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Candidate value.
 */
function generateReference(
    refId: string,
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): unknown {
    const definition = contract.definitions.get(refId);
    if (definition === undefined) {
        throw new GenerationError("reference definition is missing", {
            seed: options.seed,
            path,
            strategy: "valid.reference.missing",
            retries: 0,
            label: refId
        });
    }
    if (depth >= options.depth) {
        return generateTerminal(definition, contract, options, rng, path, depth);
    }
    return generateNode(definition, contract, options, rng.fork(`reference:${refId}`), path, depth + 1);
}

/**
 * @brief Generate a terminating value for recursive positions.
 * @param node Contract node.
 * @param contract Contract graph.
 * @param options Normalized generation options.
 * @param rng Deterministic random source.
 * @param path Current path.
 * @param depth Current depth.
 * @returns Candidate terminal value.
 */
function generateTerminal(
    node: ContractNode,
    contract: Contract,
    options: NormalizedGenerationOptions,
    rng: Rng,
    path: readonly PathSegment[],
    depth: number
): unknown {
    switch (node.kind) {
        case "array":
            return [];
        case "record":
            return {};
        case "object":
            return generateObject(node.entries, contract, options, rng, path, depth);
        case "union":
            return generateUnion(node.options, contract, options, rng, path, depth);
        case "reference":
            throw new GenerationError("recursive reference exceeded depth budget", {
                seed: options.seed,
                path,
                strategy: "valid.reference.depth",
                retries: 0,
                label: node.refId
            });
        default:
            return generateNode(node, contract, options, rng, path, depth);
    }
}

/**
 * @brief Generate a bounded ASCII string.
 * @param min Minimum length.
 * @param max Maximum length.
 * @param rng Deterministic random source.
 * @returns Candidate string.
 */
function generateBoundedString(min: number, max: number, rng: Rng): string {
    const length = rng.integer(min, Math.max(min, max));
    let value = "";
    for (let index = 0; index < length; index += 1) {
        value += ALPHABET[rng.pickIndex(ALPHABET.length)] ?? "a";
    }
    return value;
}

/**
 * @brief Generate an RFC-shaped UUID.
 * @param rng Deterministic random source.
 * @returns UUID string.
 */
function generateUuid(rng: Rng): string {
    const groups = [8, 4, 4, 4, 12];
    const values = new Array<string>(groups.length);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const length = groups[groupIndex] ?? 0;
        let group = "";
        for (let index = 0; index < length; index += 1) {
            group += rng.integer(0, 15).toString(16);
        }
        values[groupIndex] = group;
    }
    const version = values[2] ?? "4000";
    const variant = values[3] ?? "8000";
    values[2] = `4${version.slice(1)}`;
    values[3] = `${["8", "9", "a", "b"][rng.integer(0, 3)] ?? "8"}${variant.slice(1)}`;
    return values.join("-");
}

/**
 * @brief Check plain record shape.
 * @param value Candidate value.
 * @returns True when the value can be object-spread safely.
 */
function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
