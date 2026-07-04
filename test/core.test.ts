import { describe, expect, expectTypeOf, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    t,
    type Guard,
    type Infer
} from "typesea";
import {
    GenerationError,
    contractFromGuard,
    corpusFromFuzzCases,
    fuzz,
    inspectCorpus,
    inspect,
    parseCaseId,
    jsonHttpRunner,
    payloadPacks,
    readCorpus,
    replay,
    sample,
    samples,
    shrink,
    suite,
    writeCorpus,
    type OverrideContext
} from "../src/index.js";

describe("SeaFlow core generation", () => {
    test("generates TypeSea-accepted mock data", () => {
        const User = t.strictObject({
            id: t.string.uuid(),
            name: t.string.min(2).max(16),
            age: t.number.int().gte(0).lte(130),
            role: t.union(t.literal("admin"), t.literal("user"))
        });

        const user = sample(User, { seed: "user" });

        expectTypeOf(user).toEqualTypeOf<Infer<typeof User>>();
        expect(User.check(user).ok).toBe(true);
    });

    test("keeps seeded generation deterministic", () => {
        const User = t.strictObject({
            id: t.string.uuid(),
            name: t.string.min(2),
            age: t.number.int().gte(0)
        });

        const left = sample(User, { seed: "stable" });
        const right = sample(User, { seed: "stable" });
        const different = sample(User, { seed: "other" });

        expect(left).toEqual(right);
        expect(left).not.toEqual(different);
    });

    test("applies user-defined valid sample overrides before oracle admission", () => {
        const User = t.strictObject({
            name: t.string.min(2),
            role: t.union(t.literal("admin"), t.literal("user")),
            profile: t.strictObject({
                bio: t.string.min(3)
            })
        });

        const user = sample(User, {
            seed: "override",
            overrides: [
                {
                    path: ["role"],
                    value: "admin"
                },
                {
                    path: ["profile", "bio"],
                    value: ({ rng }: OverrideContext): string =>
                        `bio_${String(rng.integer(100, 999))}`
                }
            ]
        });

        expect(user.role).toBe("admin");
        expect(user.profile.bio.startsWith("bio_")).toBe(true);
        expect(User.check(user).ok).toBe(true);
    });

    test("supports override map shorthand with dotted paths", () => {
        const User = t.strictObject({
            profile: t.strictObject({
                displayName: t.string.min(2)
            })
        });

        const user = sample(User, {
            seed: "override-map",
            overrides: {
                "profile.displayName": "Ada"
            }
        });

        expect(user.profile.displayName).toBe("Ada");
        expect(User.check(user).ok).toBe(true);
    });

    test("generates finite sample streams", () => {
        const UserId = t.string.uuid();
        const values = [...samples(UserId, { seed: "ids", count: 4 })];

        expect(values).toHaveLength(4);
        for (let index = 0; index < values.length; index += 1) {
            expect(UserId.check(values[index]).ok).toBe(true);
        }
    });

    test("normalizes lazy recursion through references", () => {
        interface Tree {
            readonly value: string;
            readonly children: Tree[];
        }

        const TreeGuard: Guard<Tree> = t.lazy((): Guard<Tree> =>
            t.object({
                value: t.string.min(1),
                children: t.array(TreeGuard)
            })
        );

        const tree = sample(TreeGuard, {
            seed: "tree",
            depth: 2,
            maxArrayLength: 2
        });

        expect(TreeGuard.check(tree).ok).toBe(true);
    });

    test("emits invalid fuzz cases rejected by TypeSea", () => {
        const User = t.strictObject({
            id: t.string.uuid(),
            age: t.number.int().gte(0)
        });

        const cases = [...fuzz(User, { seed: "bad-user", count: 3 })];

        expect(cases).toHaveLength(3);
        for (let index = 0; index < cases.length; index += 1) {
            const case_ = cases[index];
            expect(case_?.valid).toBe(false);
            expect(User.check(case_?.value).ok).toBe(false);
            expect(case_?.id.startsWith("sf:bad-user:invalid:")).toBe(true);
        }
    });

    test("uses user-defined fuzz targets before automatic mutation", () => {
        const Comment = t.strictObject({
            body: t.string.min(4).max(16)
        });

        const cases = [...fuzz(Comment, {
            seed: "target",
            count: 1,
            targets: [
                {
                    path: ["body"],
                    values: [""],
                    strategy: "body.empty",
                    reason: "body should not be empty"
                }
            ]
        })];

        expect(cases[0]?.strategy).toBe("body.empty");
        expect(cases[0]?.reason).toBe("body should not be empty");
        expect(Comment.check(cases[0]?.value).ok).toBe(false);
    });

    test("attaches built-in payload packs to fuzz targets", () => {
        const Comment = t.strictObject({
            body: t.string.max(8)
        });

        const cases = [...fuzz(Comment, {
            seed: "packs",
            count: 1,
            targets: [
                {
                    path: ["body"],
                    packs: ["xss"],
                    strategy: "body.xss"
                }
            ]
        })];

        expect(payloadPacks.xss.values.length).toBeGreaterThan(0);
        expect(cases[0]?.strategy).toBe("body.xss");
        expect(Comment.check(cases[0]?.value).ok).toBe(false);
    });

    test("inspects user-supplied payloads with TypeSea diagnostics", () => {
        const User = t.strictObject({
            id: t.string.uuid(),
            age: t.number.int().gte(0)
        });

        const report = inspect(User, [
            {
                id: "ok",
                value: {
                    id: "550e8400-e29b-41d4-a716-446655440000",
                    age: 37
                }
            },
            {
                id: "bad",
                value: {
                    id: "not-a-uuid",
                    age: -1
                }
            }
        ]);

        expect(report.ok).toBe(false);
        expect(report.valid).toBe(1);
        expect(report.invalid).toBe(1);
        expect(report.cases[0]?.valid).toBe(true);
        expect(report.cases[1]?.valid).toBe(false);
    });

    test("can create hostile-js strict object payloads without running getters", () => {
        const User = t.strictObject({
            id: t.string.uuid()
        });
        let getterRan = false;
        const cases = [...fuzz(User, {
            seed: "hostile",
            count: 1,
            domain: "hostile-js"
        })];
        const value = cases[0]?.value;

        if (typeof value === "object" && value !== null) {
            Object.defineProperty(value, "__seaflow_accessor", {
                configurable: true,
                enumerable: true,
                get: (): unknown => {
                    getterRan = true;
                    return true;
                }
            });
        }

        expect(User.check(value).ok).toBe(false);
        expect(getterRan).toBe(false);
    });

    test("throws GenerationError after retry budget is exhausted", () => {
        expect(() => {
            sample(t.never, {
                seed: "never",
                maxRetries: 1
            });
        }).toThrow(GenerationError);
    });

    test("runs generated cases against a target and marks failed outputs", async () => {
        const User = t.strictObject({
            id: t.string.uuid(),
            age: t.number.int().gte(0)
        });

        const report = await suite(User)
            .valid({ seed: "runner-ok", count: 1 })
            .invalid({ seed: "runner-bad", count: 2 })
            .against(
                (case_): number => case_.kind === "invalid" ? 500 : 200,
                {
                    failWhen: (status): boolean => status >= 500
                }
            );

        expect(report.total).toBe(3);
        expect(report.passed).toBe(1);
        expect(report.failed).toBe(2);
        expect(report.ok).toBe(false);
    });

    test("supports suite timeout retries", async () => {
        const Name = t.string.min(1);
        let calls = 0;

        const report = await suite(Name)
            .valid({ seed: "timeout-retry", count: 1 })
            .against(
                async (): Promise<number> => {
                    calls += 1;
                    if (calls === 1) {
                        return delay(20, 500);
                    }
                    return 200;
                },
                {
                    timeoutMs: 5,
                    retries: 1,
                    failWhen: (status): boolean => status >= 500
                }
            );

        expect(calls).toBe(2);
        expect(report.ok).toBe(true);
        expect(report.results[0]?.attempts).toBe(2);
    });

    test("limits suite runner concurrency", async () => {
        const Name = t.string.min(1);
        let active = 0;
        let maxActive = 0;

        const report = await suite(Name)
            .valid({ seed: "concurrency", count: 4 })
            .against(
                async (): Promise<number> => {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    const status = await delay(5, 200);
                    active -= 1;
                    return status;
                },
                {
                    concurrency: 2
                }
            );

        expect(report.ok).toBe(true);
        expect(maxActive).toBe(2);
    });

    test("can stop suite execution after the first failure", async () => {
        const Name = t.string.min(1);

        const report = await suite(Name)
            .valid({ seed: "stop", count: 4 })
            .against(
                (): number => 500,
                {
                    failWhen: (status): boolean => status >= 500,
                    stopOnFailure: true
                }
            );

        expect(report.total).toBe(1);
        expect(report.failed).toBe(1);
    });

    test("honors an already aborted suite signal", async () => {
        const Name = t.string.min(1);
        const controller = new AbortController();
        controller.abort();

        const report = await suite(Name)
            .valid({ seed: "abort", count: 4 })
            .against(
                (): number => 200,
                {
                    signal: controller.signal
                }
            );

        expect(report.total).toBe(0);
        expect(report.ok).toBe(true);
    });

    test("runs suite cases through the JSON HTTP helper", async () => {
        const User = t.strictObject({
            id: t.string.uuid()
        });
        const server = createServer((request, response) => {
            let body = "";
            request.setEncoding("utf8");
            request.on("data", (chunk: string) => {
                body += chunk;
            });
            request.on("end", () => {
                response.statusCode = body.includes("not-a-uuid") ? 400 : 200;
                response.end("ok");
            });
        });
        const url = await listen(server);
        const report = await suite(User)
            .valid({ seed: "http-ok", count: 1 })
            .invalid({
                seed: "http-bad",
                count: 1,
                targets: [
                    {
                        path: ["id"],
                        values: ["not-a-uuid"],
                        strategy: "id.bad"
                    }
                ]
            })
            .against(jsonHttpRunner(url), {
                failWhen: (result): boolean => result.status >= 500
            });
        await closeServer(server);

        expect(report.ok).toBe(true);
        expect(report.results.map((result) => result.output?.status)).toEqual([200, 400]);
    });

    test("shrinks failing suite payloads when requested", async () => {
        const Payload = t.strictObject({
            body: t.string.min(1).max(20)
        });

        const report = await suite(Payload)
            .invalid({
                seed: "shrink-suite",
                count: 1,
                targets: [
                    {
                        path: ["body"],
                        values: ["xxxxxxxxxxxxxxxxxxxxx"],
                        strategy: "body.long"
                    }
                ]
            })
            .against(
                (case_): number =>
                    typeof case_.value === "object" &&
                    case_.value !== null &&
                    "body" in case_.value
                        ? 500
                        : 200,
                {
                    failWhen: (status): boolean => status >= 500,
                    shrink: {
                        maxRounds: 10
                    }
                }
            );

        expect(report.results[0]?.shrunk?.shrunk).toBe(true);
    });

    test("replays invalid fuzz cases from case ids", () => {
        const User = t.strictObject({
            id: t.string.uuid(),
            age: t.number.int().gte(0)
        });
        const first = [...fuzz(User, {
            seed: "replay-bad",
            count: 1
        })][0];

        expect(first).not.toBeUndefined();
        if (first !== undefined) {
            const replayed = replay(User, first.id);
            expect(replayed.kind).toBe("invalid");
            expect(replayed.value).toEqual(first.value);
            expect(parseCaseId(first.id).seed).toBe("replay-bad");
        }
    });

    test("replays invalid custom target cases when supplied the same options", () => {
        const Comment = t.strictObject({
            body: t.string.min(2).max(8)
        });
        const invalidOptions = {
            targets: [
                {
                    path: ["body"],
                    values: [""],
                    strategy: "body.empty"
                }
            ]
        } as const;
        const first = [...fuzz(Comment, {
            seed: "replay-target",
            count: 1,
            ...invalidOptions
        })][0];

        expect(first).not.toBeUndefined();
        if (first !== undefined) {
            const replayed = replay(Comment, first.id, {
                invalid: invalidOptions
            });
            expect(replayed.kind).toBe("invalid");
            expect(replayed.value).toEqual(first.value);
        }
    });

    test("persists JSON-safe corpora and inspects them again", async () => {
        const User = t.strictObject({
            id: t.string.uuid(),
            age: t.number.int().gte(0)
        });
        const cases = [...fuzz(User, {
            seed: "corpus",
            count: 2
        })];
        const corpus = corpusFromFuzzCases(cases);
        const directory = await mkdtemp(join(tmpdir(), "seaflow-"));
        const path = join(directory, "corpus.json");

        await writeCorpus(path, corpus);
        const restored = await readCorpus(path);
        const report = inspectCorpus(User, restored);
        await rm(directory, {
            force: true,
            recursive: true
        });

        expect(restored.cases).toHaveLength(2);
        expect(report.invalid).toBe(2);
    });


    test("replays valid suite case ids with overrides", () => {
        const User = t.strictObject({
            role: t.union(t.literal("admin"), t.literal("user"))
        });
        const replayed = replay(User, "sf:admin-seed:valid:0:sample", {
            valid: {
                overrides: {
                    role: "admin"
                }
            }
        });

        expect(replayed.kind).toBe("valid");
        if (replayed.kind === "valid") {
            expect(replayed.value.role).toBe("admin");
        }
    });

    test("exposes TypeSea schema fallback with precise presence semantics", () => {
        const User = t.strictObject({
            optionalName: t.optional(t.string),
            requiredTitle: t.undefinedable(t.string)
        });
        const contract = contractFromGuard(User);

        expect(contract.root.kind).toBe("object");
        if (contract.root.kind === "object") {
            const optional = contract.root.entries.find((entry) =>
                entry.key === "optionalName"
            );
            const required = contract.root.entries.find((entry) =>
                entry.key === "requiredTitle"
            );
            expect(optional?.presence).toBe("optional");
            expect(required?.presence).toBe("required");
        }
        expect(User.check({
            requiredTitle: undefined
        }).ok).toBe(true);
        expect(User.check({
            optionalName: undefined,
            requiredTitle: undefined
        }).ok).toBe(false);
    });

    test("shrinks standalone payloads with an interesting predicate", async () => {
        const result = await shrink(
            {
                body: "xxxxxxxx"
            },
            (value): boolean =>
                typeof value === "object" &&
                value !== null &&
                "body" in value
        );

        expect(result.shrunk).toBe(true);
        expect(result.value).toEqual({
            body: ""
        });
    });
});

/**
 * @brief Resolve a value after a timeout.
 * @param ms Delay in milliseconds.
 * @param value Resolved value.
 * @returns Delayed promise.
 */
function delay<TValue>(ms: number, value: TValue): Promise<TValue> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(value);
        }, ms);
    });
}

/**
 * @brief Listen on an ephemeral local port.
 * @param server HTTP server.
 * @returns Server URL.
 */
function listen(server: Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address === null || typeof address === "string") {
                reject(new Error("server address is unavailable"));
                return;
            }
            resolve(`http://127.0.0.1:${String(address.port)}`);
        });
    });
}

/**
 * @brief Close a server.
 * @param server HTTP server.
 * @returns Close promise.
 */
function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error !== undefined) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
