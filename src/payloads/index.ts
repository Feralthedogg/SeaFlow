/**
 * @file index.ts
 * @brief Built-in adversarial payload packs.
 * @details Packs are small deterministic corpora users can attach to fuzz targets.
 */

export type PayloadPackName =
    | "xss"
    | "sqli"
    | "nosql"
    | "traversal"
    | "ssrf"
    | "command"
    | "template"
    | "headers"
    | "unicode"
    | "oversized"
    | "security";

export interface PayloadPack {
    readonly name: PayloadPackName;
    readonly values: readonly unknown[];
}

const XSS_VALUES = Object.freeze([
    "<script>alert(1)</script>",
    "\"><img src=x onerror=alert(1)>",
    "javascript:alert(1)"
]);

const SQLI_VALUES = Object.freeze([
    "' OR '1'='1",
    "' OR 1=1 --",
    "\"; DROP TABLE users; --",
    "admin'/*",
    "1 UNION SELECT NULL,NULL--"
]);

const NOSQL_VALUES = Object.freeze([
    "{\"$ne\":null}",
    "{\"$gt\":\"\"}",
    "{\"$where\":\"sleep(1000)\"}"
]);

const TRAVERSAL_VALUES = Object.freeze([
    "../../etc/passwd",
    "..\\..\\windows\\win.ini",
    "%2e%2e/%2e%2e/etc/passwd",
    "....//....//etc/passwd"
]);

const SSRF_VALUES = Object.freeze([
    "http://127.0.0.1:80/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/"
]);

const COMMAND_VALUES = Object.freeze([
    "; id",
    "&& whoami",
    "| cat /etc/passwd",
    "`id`",
    "$(id)"
]);

const TEMPLATE_VALUES = Object.freeze([
    "{{7*7}}",
    "${7*7}",
    "<%= 7 * 7 %>"
]);

const HEADER_VALUES = Object.freeze([
    "127.0.0.1\r\nX-Injected: true",
    "text/plain\r\n\r\n<script>alert(1)</script>",
    "Bearer invalid\r\nX-Role: admin"
]);

const UNICODE_VALUES = Object.freeze([
    "admin\u200d",
    "Ａｄｍｉｎ",
    "\u0000",
    "paypa\u043b.com",
    "\u202eexe.txt"
]);

const OVERSIZED_VALUES = Object.freeze([
    "x".repeat(8192)
]);

export const payloadPacks: Readonly<Record<PayloadPackName, PayloadPack>> = Object.freeze({
    xss: Object.freeze({
        name: "xss",
        values: XSS_VALUES
    }),
    sqli: Object.freeze({
        name: "sqli",
        values: SQLI_VALUES
    }),
    nosql: Object.freeze({
        name: "nosql",
        values: NOSQL_VALUES
    }),
    traversal: Object.freeze({
        name: "traversal",
        values: TRAVERSAL_VALUES
    }),
    ssrf: Object.freeze({
        name: "ssrf",
        values: SSRF_VALUES
    }),
    command: Object.freeze({
        name: "command",
        values: COMMAND_VALUES
    }),
    template: Object.freeze({
        name: "template",
        values: TEMPLATE_VALUES
    }),
    headers: Object.freeze({
        name: "headers",
        values: HEADER_VALUES
    }),
    unicode: Object.freeze({
        name: "unicode",
        values: UNICODE_VALUES
    }),
    oversized: Object.freeze({
        name: "oversized",
        values: OVERSIZED_VALUES
    }),
    security: Object.freeze({
        name: "security",
        values: Object.freeze([
            ...XSS_VALUES,
            ...SQLI_VALUES,
            ...NOSQL_VALUES,
            ...TRAVERSAL_VALUES,
            ...SSRF_VALUES,
            ...COMMAND_VALUES,
            ...TEMPLATE_VALUES,
            ...HEADER_VALUES,
            ...UNICODE_VALUES,
            ...OVERSIZED_VALUES
        ])
    })
});

/**
 * @brief Resolve pack names into payload values.
 * @param names Pack names.
 * @returns Flattened payload values.
 */
export function payloadValuesForPacks(
    names: readonly PayloadPackName[]
): readonly unknown[] {
    const values: unknown[] = [];
    for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        if (name === undefined) {
            continue;
        }
        const pack = payloadPacks[name];
        for (let valueIndex = 0; valueIndex < pack.values.length; valueIndex += 1) {
            values.push(pack.values[valueIndex]);
        }
    }
    return Object.freeze(values);
}
