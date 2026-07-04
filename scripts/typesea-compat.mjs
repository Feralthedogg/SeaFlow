import { t } from "typesea";

const expected = [
    ["string", t.string.schema.tag, 1],
    ["number", t.number.schema.tag, 2],
    ["boolean", t.boolean.schema.tag, 3],
    ["literal", t.literal("x").schema.tag, 4],
    ["array", t.array(t.string).schema.tag, 5],
    ["object", t.object({ value: t.string }).schema.tag, 6],
    ["union", t.union(t.literal("a"), t.literal("b")).schema.tag, 7],
    ["optional", t.optional(t.string).schema.tag, 8],
    ["undefinedable", t.undefinedable(t.string).schema.tag, 9],
    ["nullable", t.nullable(t.string).schema.tag, 10],
    [
        "discriminatedUnion",
        t.discriminatedUnion("kind", {
            a: t.object({
                kind: t.literal("a")
            })
        }).schema.tag,
        11
    ],
    ["tuple", t.tuple([t.string]).schema.tag, 13],
    ["record", t.record(t.string).schema.tag, 14],
    ["lazy", t.lazy(() => t.string).schema.tag, 15],
    ["refine", t.string.refine((value) => value.length > 0, "non_empty").schema.tag, 16],
    ["unknown", t.unknown.schema.tag, 17],
    ["never", t.never.schema.tag, 18],
    ["bigint", t.bigint.schema.tag, 19],
    ["symbol", t.symbol.schema.tag, 20],
    ["intersection", t.intersect(t.object({ a: t.string }), t.object({ b: t.string })).schema.tag, 21]
];

const objectSchema = t.strictObject({
    optionalName: t.optional(t.string),
    requiredTitle: t.undefinedable(t.string)
}).schema;

let failed = false;

for (let index = 0; index < expected.length; index += 1) {
    const row = expected[index];
    if (row === undefined) {
        continue;
    }
    const [name, actual, expectedTag] = row;
    if (actual !== expectedTag) {
        console.error(`${name} tag changed: expected ${expectedTag}, got ${actual}`);
        failed = true;
    }
}

const optionalEntry = objectSchema.entries.find((entry) => entry.key === "optionalName");
const requiredEntry = objectSchema.entries.find((entry) => entry.key === "requiredTitle");
if (optionalEntry?.presence !== 2) {
    console.error("optional presence tag changed");
    failed = true;
}
if (requiredEntry?.presence !== 1) {
    console.error("required presence tag changed");
    failed = true;
}

if (failed) {
    process.exitCode = 1;
}

