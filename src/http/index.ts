/**
 * @file index.ts
 * @brief HTTP runner helpers.
 * @details These helpers adapt suite cases to ordinary JSON HTTP requests while keeping
 * the core runner generic for tRPC, Fastify inject, or in-process handlers.
 */

import type {
    SuiteCase,
    SuiteRunner
} from "../suite/index.js";

export interface JsonHttpRunnerOptions<TValue> {
    readonly method?: string;
    readonly headers?: HeadersInit;
    readonly mapValue?: (case_: SuiteCase<TValue>) => unknown;
    readonly init?: Omit<RequestInit, "body" | "headers" | "method">;
}

export interface JsonHttpResult {
    readonly status: number;
    readonly ok: boolean;
    readonly text: string;
}

/**
 * @brief Create a suite runner that sends each case as JSON.
 * @param url Target URL.
 * @param options HTTP options.
 * @returns Suite runner.
 */
export function jsonHttpRunner<TValue>(
    url: string,
    options?: JsonHttpRunnerOptions<TValue>
): SuiteRunner<TValue, JsonHttpResult> {
    return async (case_): Promise<JsonHttpResult> => {
        const headers = new Headers(options?.headers);
        if (!headers.has("content-type")) {
            headers.set("content-type", "application/json");
        }
        const response = await fetch(url, {
            ...options?.init,
            method: options?.method ?? "POST",
            headers,
            body: JSON.stringify(options?.mapValue === undefined
                ? case_.value
                : options.mapValue(case_))
        });
        return Object.freeze({
            status: response.status,
            ok: response.ok,
            text: await response.text()
        });
    };
}

