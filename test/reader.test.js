import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CjsHlslReader } from "../src/index.js";
import { buildEffectBytes } from "./synthetic.js";

test("static read and instance Read share one code path", () =>
{
    const bytes = buildEffectBytes();
    const fromStatic = CjsHlslReader.read(bytes, { source: "synthetic" });
    const fromInstance = new CjsHlslReader({ source: "synthetic" }).Read(bytes);
    assert.deepEqual(fromStatic, fromInstance);
});

test("json emit is the documented plain effect graph", () =>
{
    const bytes = buildEffectBytes({
        permutations: [ {
            name: "BLEND_MODE",
            description: "Blend mode selector",
            defaultOption: 0,
            options: [ "OPAQUE", "TRANSPARENT" ]
        } ]
    });
    const result = CjsHlslReader.read(bytes, { source: "synthetic" });

    assert.equal(result.version, 8);
    assert.equal(result.bodyCount, 1);
    assert.equal(result.loadError, null);
    assert.deepEqual(result.permutations.map((entry) => entry.name), [ "BLEND_MODE" ]);
    assert.deepEqual(result.permutations[0].options, [ "OPAQUE", "TRANSPARENT" ]);
    // The synthetic body is zero-length, so the default permutation cannot
    // be decoded into an effect description; the graph reports that plainly.
    assert.equal(result.effect, null);
    // JSON-compatible end to end
    assert.equal(typeof JSON.stringify(result), "string");
});

test("raw emit exposes the live Tr2EffectRes graph", () =>
{
    const result = CjsHlslReader.read(buildEffectBytes(), { emit: CjsHlslReader.OUTPUT_RAW });

    assert.equal(result.constructor.name, "Tr2EffectRes");
    assert.equal(result.IsGood(), true);
    assert.equal(result.m_version, 8);
});

test("Inspect summarizes the default permutation without a full JSON conversion", () =>
{
    const summary = CjsHlslReader.inspect(buildEffectBytes(), { source: "synthetic" });

    assert.equal(summary.version, 8);
    assert.equal(summary.isGood, true);
    assert.equal(summary.permutationCount, 0);
    assert.equal(summary.bodyCount, 1);
    // The synthetic body is zero-length, so the default permutation cannot
    // be decoded into a Tr2Shader; Inspect reports that gracefully.
    assert.deepEqual(summary.techniques, []);
    assert.equal(summary.effectName, null);
});

test("profiles hold values and reject invalid emits", () =>
{
    const reader = new CjsHlslReader({ emit: CjsHlslReader.OUTPUT_RAW, source: "profile" });
    assert.equal(reader.GetValues().emit, CjsHlslReader.OUTPUT_RAW);
    assert.equal(reader.GetValues({ source: "override" }).source, "override");
    assert.equal(reader.GetValues().source, "profile");
    assert.throws(() => new CjsHlslReader({ emit: "nonsense" }), /emit must be/);
    assert.throws(() => CjsHlslReader.read(buildEffectBytes(), { emit: "nonsense" }), /emit must be/);
});

test("toJSON converts typed arrays and nested structures", () =>
{
    const converted = CjsHlslReader.toJSON({
        tokens: new Uint32Array([ 1, 2 ]),
        nested: [ { mask: new Uint8Array([ 3 ]) } ]
    });
    assert.deepEqual(converted, { tokens: [ 1, 2 ], nested: [ { mask: [ 3 ] } ] });

    const reader = new CjsHlslReader();
    assert.deepEqual(reader.ToJSON(new Uint8Array([ 4, 5 ])), [ 4, 5 ]);
});

test("isSupported accepts a well-formed header and rejects garbage or truncated data", () =>
{
    assert.equal(CjsHlslReader.isSupported(buildEffectBytes()), true);
    assert.equal(CjsHlslReader.isSupported(new Uint8Array([ 1, 2, 3, 4, 5 ])), false);
    assert.equal(CjsHlslReader.isSupported(new Uint8Array(0)), false);
    assert.equal(CjsHlslReader.isSupported(buildEffectBytes({ version: 99 })), false);
});

test("out-of-range version is rejected with a read error", () =>
{
    assert.throws(() => CjsHlslReader.read(buildEffectBytes({ version: 99 })), /Tr2EffectRes/);
});

test("truncated header is rejected with a read error", () =>
{
    const bytes = buildEffectBytes().subarray(0, 2);
    assert.throws(() => CjsHlslReader.read(bytes));
});

test("readFile validates its path argument", async () =>
{
    await assert.rejects(() => CjsHlslReader.readFile(123), TypeError);
    await assert.rejects(() => CjsHlslReader.readFile(""), TypeError);
    await assert.rejects(() => CjsHlslReader.readFile("does-not-exist.sm_hi"));
});

test("readFile reads and parses a compiled effect file from disk", async () =>
{
    const dir = await mkdtemp(path.join(tmpdir(), "reader-hlsl-"));
    const filePath = path.join(dir, "synthetic.sm_hi");
    try
    {
        await writeFile(filePath, buildEffectBytes());
        const result = await CjsHlslReader.readFile(filePath);
        assert.equal(result.version, 8);
        assert.equal(result.bodyCount, 1);
    }
    finally
    {
        await rm(dir, { recursive: true, force: true });
    }
});

test("CLASS_KEYS lists the hydratable node kinds", () =>
{
    assert.deepEqual(CjsHlslReader.CLASS_KEYS, [
        "Root",
        "Permutation",
        "EffectDescription",
        "Technique",
        "Pass",
        "StageInput",
        "Constant",
        "Resource",
        "Sampler",
        "ShaderBytecode"
    ]);
});

test("classes option hydrates registered node kinds instead of plain objects", () =>
{
    class EffectRoot
    {}
    class ShaderPermutation
    {}

    const bytes = buildEffectBytes({
        permutations: [ { name: "BLEND_MODE", description: "", defaultOption: 0, options: [ "OPAQUE" ] } ]
    });
    const result = CjsHlslReader.read(bytes, {
        source: "synthetic",
        classes: { Root: EffectRoot, Permutation: ShaderPermutation }
    });

    assert.ok(result instanceof EffectRoot);
    assert.ok(result.permutations[0] instanceof ShaderPermutation);
    assert.equal(result.permutations[0].name, "BLEND_MODE");
});

test("instance SetClass/SetClasses/GetClass/HasClass manage the node class map", () =>
{
    class EffectRoot
    {}

    const reader = new CjsHlslReader();
    assert.equal(reader.HasClass("Root"), false);
    reader.SetClass("Root", EffectRoot);
    assert.equal(reader.HasClass("Root"), true);
    assert.equal(reader.GetClass("Root"), EffectRoot);

    reader.SetClass("Root", null);
    assert.equal(reader.HasClass("Root"), false);

    reader.SetClasses({ Root: EffectRoot });
    assert.equal(reader.GetClass("Root"), EffectRoot);

    assert.throws(() => reader.GetClass("NotARealKey"), /unknown class key/);
    assert.throws(() => reader.SetClass("NotARealKey", EffectRoot), /unknown class key/);
    assert.throws(() => reader.SetClass("Root", 123), /must be a constructor/);
});

test("unknown options and non-object classes are rejected", () =>
{
    assert.throws(() => new CjsHlslReader({ nonsense: true }), /unknown option/);
    assert.throws(() => CjsHlslReader.read(buildEffectBytes(), { classes: 123 }), /classes option must be an object/);
});
