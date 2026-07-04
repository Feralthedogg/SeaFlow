/**
 * @file node.ts
 * @brief SeaFlow's normalized contract graph.
 * @details TypeSea schemas are normalized into this smaller model before generators
 * produce valid samples or adversarial mutations.
 */

export type PathSegment = string | number;

export type ContractNode =
    | UnknownContractNode
    | NeverContractNode
    | StringContractNode
    | NumberContractNode
    | BigIntContractNode
    | SymbolContractNode
    | BooleanContractNode
    | LiteralContractNode
    | ArrayContractNode
    | TupleContractNode
    | RecordContractNode
    | ObjectContractNode
    | UnionContractNode
    | IntersectionContractNode
    | OptionalContractNode
    | NullableContractNode
    | UndefinedableContractNode
    | ReferenceContractNode
    | OpaqueContractNode;

export interface Contract {
    readonly root: ContractNode;
    readonly definitions: ReadonlyMap<string, ContractNode>;
}

export interface UnknownContractNode {
    readonly kind: "unknown";
}

export interface NeverContractNode {
    readonly kind: "never";
}

export interface StringContractNode {
    readonly kind: "string";
    readonly min: number | undefined;
    readonly max: number | undefined;
    readonly format: "uuid" | undefined;
    readonly regex: readonly RegexConstraint[];
}

export interface RegexConstraint {
    readonly source: string;
    readonly flags: string;
    readonly name: string;
}

export interface NumberContractNode {
    readonly kind: "number";
    readonly int: boolean;
    readonly gte: number | undefined;
    readonly lte: number | undefined;
}

export interface BigIntContractNode {
    readonly kind: "bigint";
}

export interface SymbolContractNode {
    readonly kind: "symbol";
}

export interface BooleanContractNode {
    readonly kind: "boolean";
}

export interface LiteralContractNode {
    readonly kind: "literal";
    readonly value: unknown;
}

export interface ArrayContractNode {
    readonly kind: "array";
    readonly item: ContractNode;
}

export interface TupleContractNode {
    readonly kind: "tuple";
    readonly items: readonly ContractNode[];
}

export interface RecordContractNode {
    readonly kind: "record";
    readonly value: ContractNode;
}

export interface ObjectContractNode {
    readonly kind: "object";
    readonly mode: ObjectMode;
    readonly entries: readonly ContractObjectEntry[];
}

export interface ContractObjectEntry {
    readonly key: string;
    readonly node: ContractNode;
    readonly presence: ObjectEntryPresence;
}

export type ObjectMode = "passthrough" | "strict";

export type ObjectEntryPresence = "required" | "optional";

export interface UnionContractNode {
    readonly kind: "union";
    readonly options: readonly ContractNode[];
}

export interface IntersectionContractNode {
    readonly kind: "intersection";
    readonly left: ContractNode;
    readonly right: ContractNode;
}

export interface OptionalContractNode {
    readonly kind: "optional";
    readonly inner: ContractNode;
}

export interface NullableContractNode {
    readonly kind: "nullable";
    readonly inner: ContractNode;
}

export interface UndefinedableContractNode {
    readonly kind: "undefinedable";
    readonly inner: ContractNode;
}

export interface ReferenceContractNode {
    readonly kind: "reference";
    readonly refId: string;
}

export interface OpaqueContractNode {
    readonly kind: "opaque";
    readonly label: string;
    readonly inner: ContractNode | undefined;
}
