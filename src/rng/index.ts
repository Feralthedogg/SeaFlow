/**
 * @file index.ts
 * @brief Deterministic seeded pseudo-random generator.
 * @details SeaFlow case ids must reproduce the same payloads across runs, so all
 * generator choices flow through this small PRNG wrapper.
 */

export interface Rng {
    next(): number;
    integer(min: number, max: number): number;
    boolean(probability: number): boolean;
    pickIndex(length: number): number;
    fork(label: string): Rng;
}

export class SeededRng implements Rng {
    private state: number;
    private readonly seed: string;

    /**
     * @brief Construct a deterministic generator.
     * @param seed User-facing seed text.
     */
    public constructor(seed: string) {
        this.seed = seed;
        this.state = hashSeed(seed);
    }

    /**
     * @brief Produce the next float in [0, 1).
     * @returns Pseudo-random float.
     */
    public next(): number {
        let value = this.state;
        value += 0x6D2B79F5;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        this.state = value;
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    }

    /**
     * @brief Pick an integer in the inclusive range.
     * @param min Inclusive lower bound.
     * @param max Inclusive upper bound.
     * @returns Deterministic integer.
     */
    public integer(min: number, max: number): number {
        if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
            throw new TypeError("integer range must be ordered integers");
        }
        const span = max - min + 1;
        return min + Math.floor(this.next() * span);
    }

    /**
     * @brief Pick a boolean using the supplied probability.
     * @param probability Inclusive probability threshold from 0 to 1.
     * @returns Deterministic boolean.
     */
    public boolean(probability: number): boolean {
        if (!Number.isFinite(probability) ||
            probability < 0 ||
            probability > 1) {
            throw new TypeError("boolean probability must be between 0 and 1");
        }
        return this.next() < probability;
    }

    /**
     * @brief Pick an array index.
     * @param length Array-like length.
     * @returns Deterministic index.
     */
    public pickIndex(length: number): number {
        if (!Number.isInteger(length) || length <= 0) {
            throw new TypeError("pick length must be a positive integer");
        }
        return this.integer(0, length - 1);
    }

    /**
     * @brief Create a deterministic child stream.
     * @param label Child stream label.
     * @returns New PRNG seeded from this generator's seed.
     */
    public fork(label: string): Rng {
        return new SeededRng(`${this.seed}:${label}`);
    }
}

/**
 * @brief Normalize a caller-provided seed.
 * @param value Seed value.
 * @returns Stable seed text.
 */
export function normalizeSeed(value: string | number | undefined): string {
    if (value === undefined) {
        return "seaflow";
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError("seed number must be finite");
        }
        return String(value);
    }
    return value;
}

/**
 * @brief Hash seed text into a 32-bit state.
 * @param seed Seed text.
 * @returns Unsigned 32-bit hash.
 */
function hashSeed(seed: string): number {
    let hash = 0x811C9DC5;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

