# SeaFlow

[![CI](https://github.com/Feralthedogg/SeaFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/Feralthedogg/SeaFlow/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/language-TypeScript-informational)
![Module](https://img.shields.io/badge/module-ESM--only-orange)
![Node](https://img.shields.io/badge/node-%3E%3D20.19-yellowgreen)

**SeaFlow** is a **TypeSea-powered mock data and adversarial fuzzing library**
for TypeScript. It turns TypeSea guards into deterministic valid samples,
invalid boundary cases, hostile JavaScript object payloads, replayable case ids,
shrunk failures, and JSON-safe regression corpora.

> Goal: not "random fake data", but **oracle-admitted generative testing**.
> SeaFlow generates candidates, then TypeSea `Guard.check()` remains the source
> of truth for every accepted valid sample and every emitted invalid fuzz case.

> [!IMPORTANT]
> SeaFlow is a test tool, not a validator. Keep TypeSea at the boundary of your
> application. Use SeaFlow to create payloads, inspect payloads, run generated
> cases against services, replay failures, and persist JSON-safe regressions.

---

## Why

Mock data usually rots because it is handwritten. Fuzz data usually misses the
interesting edge because it does not know your real runtime contract.

SeaFlow focuses on:

- **valid samples** that satisfy TypeSea constraints such as `min(8)`, `gte(0)`,
  UUID formats, strict object presence, unions, tuples, arrays, recursion, and
  wrapper semantics
- **invalid payloads** that are confirmed rejected by the original TypeSea guard
- **caller-owned targets** for paths like `email`, `profile.bio`, or root input
- **security packs** for XSS, SQL injection, NoSQL injection, path traversal,
  SSRF, command injection, template injection, header injection, unicode, and
  oversized values
- **hostile JavaScript domains** for accessor-backed, prototype-sensitive, and
  non-JSON object cases
- **replay and corpus APIs** so failures become stable CI fixtures

---

## Install

```sh
npm i @typesea/fuzzer-seaflow typesea
```

---

## Quick Start

```ts
import { t, type Infer } from "typesea";
import {
  fuzz,
  jsonHttpRunner,
  replay,
  sample,
  samples,
  suite
} from "@typesea/fuzzer-seaflow";

const User = t.strictObject({
  id: t.string.uuid(),
  name: t.string.min(2).max(40),
  age: t.number.int().gte(0).lte(130),
  role: t.union(t.literal("admin"), t.literal("user"))
});

type User = Infer<typeof User>;

// 1) Valid mock data, admitted by User.check()
const oneUser = sample(User, { seed: "demo" });
const manyUsers = [...samples(User, { seed: "demo", count: 10 })];

// 2) Invalid payloads, rejected by User.check()
const badPayloads = [...fuzz(User, {
  seed: "signup-security",
  count: 20,
  domain: "hostile-js",
  targets: [
    {
      path: ["name"],
      packs: ["xss", "sqli"],
      strategy: "name.security"
    },
    {
      path: ["age"],
      values: [-1, Number.NaN],
      strategy: "age.invalid"
    }
  ]
})];

// 3) Generated test suite against an HTTP JSON endpoint
const report = await suite(User)
  .valid({ seed: "smoke", count: 5 })
  .invalid({ seed: "attack", count: 50, domain: "hostile-js" })
  .against(jsonHttpRunner("http://localhost:3000/users"), {
    concurrency: 4,
    timeoutMs: 2_000,
    retries: 1,
    failWhen: (result) => result.status >= 500,
    shrink: true
  });

// 4) Reproduce one generated case by id
const reproduced = replay(User, badPayloads[0]!.id);
```

Use `sample()` for one value. Use `samples()` for deterministic streams. Use
`fuzz()` for rejected payloads with metadata. Use `suite()` when generated cases
must be executed against a real target.

> [!NOTE]
> SeaFlow is **ESM-only** and requires Node.js `>= 20.19`.

---

## Valid Samples

`sample()` returns `Infer<TGuard>` and only returns after the original TypeSea
guard accepts the value.

```ts
const User = t.strictObject({
  id: t.string.uuid(),
  email: t.string.min(5),
  profile: t.strictObject({
    displayName: t.string.min(2)
  })
});

const user = sample(User, {
  seed: "user-1",
  profile: "typical",
  depth: 4,
  maxArrayLength: 3,
  maxRetries: 100
});
```

| Option | Purpose |
| --- | --- |
| `seed` | Stable deterministic generation stream. |
| `profile` | Valid generation style: `typical`, `boundary`, or `wide`. |
| `depth` | Recursion and nested generation budget. |
| `maxArrayLength` | Upper bound for generated arrays. |
| `maxRetries` | Rejection-sampling budget before `GenerationError`. |

### Overrides

Overrides let callers define the data that matters while SeaFlow fills the rest
and TypeSea still performs final admission.

```ts
const admin = sample(User, {
  seed: "admin",
  overrides: {
    "profile.displayName": "Ada",
    email: ({ rng }) => `user-${rng.integer(100, 999)}@example.test`
  }
});
```

Path-rule form is useful when keys contain dots or array indexes matter.

```ts
const admin = sample(User, {
  seed: "admin",
  overrides: [
    {
      path: ["profile", "displayName"],
      value: "Ada"
    }
  ]
});
```

> [!IMPORTANT]
> Overrides are not trusted blindly. If an override makes the value fail the
> guard, SeaFlow retries until `maxRetries` is exhausted and then throws
> `GenerationError`.

---

## Invalid Fuzzing

`fuzz()` emits `FuzzCase` objects. Each case includes the payload, strategy,
path, reason, TypeSea issues, and a replayable id.

```ts
const cases = [...fuzz(User, {
  seed: "attack",
  count: 50,
  profile: "security",
  domain: "hostile-js",
  maxRetries: 100
})];

for (const case_ of cases) {
  console.log(case_.id, case_.strategy, case_.path, case_.value);
}
```

```ts
interface FuzzCase {
  readonly id: string;
  readonly seed: string;
  readonly index: number;
  readonly value: unknown;
  readonly valid: boolean;
  readonly strategy: string;
  readonly path: readonly (string | number)[];
  readonly reason: string;
  readonly issues?: readonly unknown[];
}
```

| Option | Purpose |
| --- | --- |
| `count` | Number of cases to emit. |
| `mode` | `invalid` today; `mixed` is reserved in the public type. |
| `profile` | Mutation focus: `boundary`, `type-confusion`, `presence`, `security`. |
| `domain` | Payload domain: `json`, `javascript`, or `hostile-js`. |
| `targets` | Caller-defined path payloads. |
| `packs` | Built-in payload packs, applied globally or per target. |

### Domains

| Domain | What it generates |
| --- | --- |
| `json` | JSON-serializable values only. Best for HTTP bodies and corpora. |
| `javascript` | JavaScript runtime values such as `undefined`, `NaN`, `bigint`, and `symbol`. |
| `hostile-js` | JavaScript values plus objects that exercise prototype and accessor-sensitive code paths. |

> [!CAUTION]
> `hostile-js` payloads are for in-process tests and validator hardening. Do
> not serialize them with `JSON.stringify()` expecting exact preservation. Use
> `json` when the target boundary is an HTTP JSON parser.

### Targets

Targets let users define exactly which data gets attacked.

```ts
const targeted = [...fuzz(User, {
  seed: "signup-targets",
  targets: [
    {
      path: ["email"],
      values: ["", "not-email", "' OR 1=1 --"],
      strategy: "email.custom",
      reason: "signup email should reject malformed and injection-like input"
    },
    {
      path: ["profile", "displayName"],
      packs: ["xss", "unicode"],
      strategy: "displayName.security"
    }
  ]
})];
```

Target values may also be factories.

```ts
import type { Rng } from "@typesea/fuzzer-seaflow";

const generatedTargets = [...fuzz(User, {
  seed: "factory",
  targets: [
    {
      path: ["email"],
      values: [
        ({ rng }: { readonly rng: Rng }) =>
          `user-${rng.integer(1000, 9999)}`
      ],
      strategy: "email.factory"
    }
  ]
})];
```

### Payload Packs

```ts
import { payloadPacks, payloadValuesForPacks } from "@typesea/fuzzer-seaflow";

payloadPacks.security.values;
const sqlAndXss = payloadValuesForPacks(["sqli", "xss"]);
```

| Pack | Examples of covered risk |
| --- | --- |
| `xss` | Script and HTML event-handler strings. |
| `sqli` | SQL boolean bypass and statement injection strings. |
| `nosql` | Operator-shaped NoSQL payload strings. |
| `traversal` | Unix, Windows, and encoded path traversal strings. |
| `ssrf` | Loopback and metadata-service URLs. |
| `command` | Shell metacharacter payloads. |
| `template` | Common template-expression probes. |
| `headers` | CRLF header/body injection strings. |
| `unicode` | Confusable, bidi, null, and zero-width strings. |
| `oversized` | Large strings. |
| `security` | All security-oriented packs combined. |

---

## Inspect Existing Payloads

`inspect()` does not generate data. It checks caller-provided values from logs,
fixtures, manual attack cases, or production captures.

```ts
import { inspect } from "@typesea/fuzzer-seaflow";

const inspection = inspect(User, [
  {
    id: "prod-log-1",
    value: {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Ada",
      age: 37,
      role: "admin"
    }
  },
  {
    id: "manual-attack",
    value: {
      id: "not-a-uuid",
      name: "<script>alert(1)</script>",
      age: -1,
      role: "admin"
    }
  }
]);

if (!inspection.ok) {
  console.log(inspection.invalid, inspection.cases);
}
```

---

## Test Runners

`suite()` builds valid and invalid cases, sends them to a runner, captures
outputs and thrown errors as data, and optionally shrinks failures.

```ts
const report = await suite(User)
  .valid({ seed: "ok", count: 5 })
  .invalid({
    seed: "bad",
    count: 25,
    targets: [
      {
        path: ["name"],
        packs: ["xss"]
      }
    ]
  })
  .against(
    async (case_) => {
      return app.inject({
        method: "POST",
        url: "/users",
        payload: case_.value
      });
    },
    {
      concurrency: 2,
      timeoutMs: 1_000,
      retries: 1,
      stopOnFailure: false,
      failWhen: (response) => response.statusCode >= 500,
      shrink: {
        maxRounds: 50,
        maxCandidates: 64
      }
    }
  );
```

| Runner option | Purpose |
| --- | --- |
| `failWhen` | Marks successful runner outputs as failures, for example HTTP 500. |
| `shrink` | `true` for defaults or `{ maxRounds, maxCandidates }`. |
| `concurrency` | Number of cases running at once. |
| `timeoutMs` | Per-attempt timeout. |
| `retries` | Retries for thrown or timed-out runner attempts. |
| `signal` | AbortSignal for cancellation. |
| `stopOnFailure` | Stops scheduling new cases after the first failure. |

### JSON HTTP

`jsonHttpRunner()` is a convenience adapter for ordinary JSON endpoints.

```ts
const report = await suite(User)
  .valid({ seed: "http-ok", count: 1 })
  .invalid({ seed: "http-bad", count: 10 })
  .against(jsonHttpRunner("http://localhost:3000/users", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token"
    },
    mapValue: (case_) => ({
      input: case_.value
    })
  }), {
    failWhen: (result) => result.status >= 500
  });
```

Direct callbacks are the lower-level escape hatch for tRPC routers, Fastify
`inject()`, in-process handlers, queues, workers, or custom transports.

---

## Replay

Case ids use the `sf:<seed>:<stream>:<index>:<strategy>` shape.

```ts
import { parseCaseId, replay } from "@typesea/fuzzer-seaflow";

const id = "sf:attack:invalid:42:object.required";
const parsed = parseCaseId(id);
const reproduced = replay(User, id);
```

When the original case used custom targets or valid overrides, pass the same
options during replay.

```ts
const invalidOptions = {
  targets: [
    {
      path: ["name"],
      values: [""],
      strategy: "name.empty"
    }
  ]
} as const;

const original = [...fuzz(User, {
  seed: "replay-target",
  count: 1,
  ...invalidOptions
})][0]!;

const reproduced = replay(User, original.id, {
  invalid: invalidOptions
});
```

Corpus files store concrete values, so they do not need generator options to
inspect later. Replay from ids does.

---

## Shrinking

Shrinking is schema-agnostic. It repeatedly tries smaller strings, numbers,
arrays, and objects while the predicate still says the candidate reproduces the
failure.

```ts
import { shrink } from "@typesea/fuzzer-seaflow";

const smaller = await shrink(
  {
    body: "xxxxxxxxxxxxxxxx"
  },
  async (value) => {
    const response = await fetch("http://localhost:3000/comments", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(value)
    });
    return response.status >= 500;
  },
  {
    maxRounds: 100,
    maxCandidates: 64
  }
);

console.log(smaller.value, smaller.steps);
```

`suite().against(..., { shrink: true })` runs the same shrinker automatically
for failing suite cases.

---

## Corpus

Corpora turn generated failures into portable JSON fixtures.

```ts
import {
  corpusFromFuzzCases,
  corpusFromReport,
  inspectCorpus,
  readCorpus,
  writeCorpus
} from "@typesea/fuzzer-seaflow";

const fuzzCases = [...fuzz(User, {
  seed: "corpus",
  count: 10,
  domain: "json"
})];

const directCorpus = corpusFromFuzzCases(fuzzCases);
await writeCorpus("seaflow-corpus.json", directCorpus);

const suiteReport = await suite(User)
  .invalid({ seed: "regression", count: 50, domain: "json" })
  .against(jsonHttpRunner("http://localhost:3000/users"), {
    failWhen: (result) => result.status >= 500,
    shrink: true
  });

const failureCorpus = corpusFromReport(suiteReport);
await writeCorpus("seaflow-failures.json", failureCorpus);

const restored = await readCorpus("seaflow-failures.json");
const inspection = inspectCorpus(User, restored);
```

> [!IMPORTANT]
> Corpus persistence is JSON-only by design. Values containing `symbol`,
> `bigint`, `undefined`, cycles, accessors, `NaN`, or infinities are rejected so
> saved corpora remain portable and deterministic in CI.

---

## TypeSea Semantics

SeaFlow reads TypeSea guards through `guard.schema` and normalizes them into a
small SeaFlow contract graph with strings, numbers, objects, arrays, tuples,
records, unions, intersections, wrappers, references, and opaque fallbacks.

```ts
import { contractFromGuard, contractFromSchema } from "@typesea/fuzzer-seaflow";

const contract = contractFromGuard(User);
const sameContract = contractFromSchema(User.schema);
```

Object presence is preserved exactly:

| Wrapper | Key may be absent | Value may be `undefined` |
| --- | --- | --- |
| `t.optional(inner)` | yes | no |
| `t.undefinedable(inner)` | no | yes |
| `t.nullable(inner)` | no | value may be `null` |

Recursive TypeSea `t.lazy()` schemas normalize through `kind: "reference"`
nodes with `refId` definitions. Nodes that SeaFlow cannot reverse perfectly,
such as complex refinements, fall back to opaque generation. Regex constraints
are preserved on string nodes and admitted through the TypeSea oracle when exact
reverse generation is not available.

> [!NOTE]
> Rejection sampling is budgeted by `maxRetries`. A hard schema or impossible
> override fails with `GenerationError` instead of looping forever.

SeaFlow mirrors TypeSea schema tags in `src/adapters/typesea/tags.ts`. The
compatibility gate catches TypeSea tag drift before release.

---

## API Surface

| Area | Exports |
| --- | --- |
| Valid generation | `sample`, `samples` |
| Invalid fuzzing | `fuzz`, `payloadPacks`, `payloadValuesForPacks` |
| Inspection | `inspect`, `inspectCorpus` |
| Runners | `suite`, `jsonHttpRunner` |
| Replay | `parseCaseId`, `replay` |
| Shrinking | `shrink` |
| Corpus | `corpusFromFuzzCases`, `corpusFromReport`, `readCorpus`, `writeCorpus` |
| TypeSea adapter | `contractFromGuard`, `contractFromSchema` |
| Errors | `GenerationError` |

---

## Release Gates

`npm run check` runs:

- TypeScript typecheck
- ESLint
- Vitest
- build
- TypeSea tag compatibility check
- dist public export policy
- npm pack dry-run

The explicit package file allowlist is limited to `dist`, `README.md`,
`CHANGELOG.md`, and `LICENSE`.
