/**
 * @file index.ts
 * @brief Public error values for generation failures.
 * @details Expected invalid payloads are returned as data; unrecoverable generator
 * failures use explicit errors with reproducibility metadata.
 */

import type { PathSegment } from "../contract/node.js";

export interface GenerationErrorOptions {
    readonly seed: string;
    readonly path: readonly PathSegment[];
    readonly strategy: string;
    readonly retries: number;
    readonly label: string;
}

export class GenerationError extends Error {
    public readonly seed: string;
    public readonly path: readonly PathSegment[];
    public readonly strategy: string;
    public readonly retries: number;
    public readonly label: string;

    /**
     * @brief Construct generation failure.
     * @param message Human-readable failure message.
     * @param options Reproducibility metadata.
     */
    public constructor(message: string, options: GenerationErrorOptions) {
        super(message);
        this.name = "GenerationError";
        this.seed = options.seed;
        this.path = Object.freeze([...options.path]);
        this.strategy = options.strategy;
        this.retries = options.retries;
        this.label = options.label;
        Object.freeze(this);
    }
}

