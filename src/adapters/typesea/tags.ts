/**
 * @file tags.ts
 * @brief TypeSea runtime tag values mirrored behind one adapter boundary.
 * @details TypeSea does not export these constants from its root entry point. SeaFlow
 * keeps the version-sensitive coupling isolated here.
 */

export const SchemaTag = {
    String: 1,
    Number: 2,
    Boolean: 3,
    Literal: 4,
    Array: 5,
    Object: 6,
    Union: 7,
    Optional: 8,
    Undefinedable: 9,
    Nullable: 10,
    DiscriminatedUnion: 11,
    Brand: 12,
    Tuple: 13,
    Record: 14,
    Lazy: 15,
    Refine: 16,
    Unknown: 17,
    Never: 18,
    BigInt: 19,
    Symbol: 20,
    Intersection: 21
} as const;

export const ObjectModeTag = {
    Passthrough: 1,
    Strict: 2
} as const;

export const PresenceTag = {
    Required: 1,
    Optional: 2
} as const;

export const StringCheckTag = {
    Min: 1,
    Max: 2,
    Regex: 3,
    Uuid: 4
} as const;

export const NumberCheckTag = {
    Integer: 1,
    Gte: 2,
    Lte: 3
} as const;

