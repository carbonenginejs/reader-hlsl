# @carbonenginejs/reader-hlsl

Pure-JavaScript CarbonEngineJS-facing reader for CCP's Tr2 compiled effect
container format. No native tooling, no build step; it runs in Node and the
browser.

The Tr2 effect container is a Carbon/Trinity format, not a Microsoft one —
this package has no DXBC/instruction-decoding vocabulary. It parses the
effect header (version, string table, permutation axes and compiled-body
offsets) and, per resolved permutation, the technique/pass table and
per-stage constant, resource, sampler and render-state metadata. Shader
bytecode bodies stay as opaque bytes; decoding DXBC/HLSL bytecode itself is
`@carbonenginejs/reader-dxbc`'s job, not this package's — `@carbonenginejs/reader-hlsl` has zero dependency
on it.

## Install

```sh
npm install @carbonenginejs/reader-hlsl
```

## Public API

The package root exports one public class: `CjsHlslReader`. The `Cjs`
prefix marks this as a CarbonEngineJS reader/construction boundary, not an
engine runtime class.

**The public contract is data, not classes.** `CjsHlslReader` exports no
Tr2/effect model classes. The Tr2 container parser is internal machinery
under `src/core/tr2` (not part of this package's public surface — do not
import from it). The documented JSON graph shape below is what callers
should depend on.

```js
import CjsHlslReader from "@carbonenginejs/reader-hlsl";

const reader = new CjsHlslReader({
    emit: "json",              // "json" (default) | "raw"
    source: "myeffect.sm_hi",  // name used in error details
    permutation: null,         // null/default | Map | [{ name, value }]
    classes: {
        Root: CjsHlslRoot,
        Permutation: CjsHlslPermutation,
        EffectDescription: CjsHlslEffectDescription,
        Technique: CjsHlslTechnique,
        Pass: CjsHlslPass,
        StageInput: CjsHlslStageInput,
        Constant: CjsHlslConstant,
        Resource: CjsHlslResource,
        Sampler: CjsHlslSampler,
        ShaderBytecode: CjsHlslShaderBytecode,
    }
});

const json = reader.Read(bytes);
const summary = reader.Inspect(bytes);
const text = JSON.stringify(reader.ToJSON(json));

CjsHlslReader.isSupported(bytes);             // cheap header-only load check
CjsHlslReader.read(bytes, { emit: "raw" });   // internal Tr2EffectRes graph (unstable)
await CjsHlslReader.readFile("effect.sm_hi"); // Node-only convenience, same emit rules
```

The named export is the same class for callers that prefer named imports:

```js
import { CjsHlslReader } from "@carbonenginejs/reader-hlsl";
```

## Reader Rules

- The package root exports one public reader class: `CjsHlslReader`.
- Instance methods are PascalCase because reader instances can hydrate or sit
  beside CarbonClasses without colliding with camelCase data fields.
- Static one-shot methods are camelCase because they live on `CjsHlslReader`
  itself, not on hydrated CarbonClass instances.
- `src/CjsHlslReader.js` is the public reader boundary. Parser machinery lives
  under `src/core`; transient CarbonEngine/library-shaped helpers live under
  `src/carbon` until they move to standalone core packages.
- `Read` / static `read` return JSON by default. `emit: "raw"` exposes the
  internal `Tr2EffectRes` graph for advanced callers and is not a stable schema.
- `ToJSON` / static `toJSON` converts reader output to JSON-compatible data. It
  does not decode embedded shader bytecode and is not a writer.
- Shared schema, registries, hydration utilities, and decorators belong in the
  future `@carbonenginejs/core-types` package.

### The JSON graph (`emit: "json"`, the default)

```
Root
├─ version, compilerVersion, sourcePath, bodyCount, loadError
├─ permutations: Permutation[]        // every permutation axis in the header
└─ effect: EffectDescription | null   // the resolved permutation (see below), or null
              // when its compiled body could not be decoded
   ├─ version, effectName, annotations, readError
   └─ techniques: Technique[]
      └─ passes: Pass[]
         ├─ renderStates: {key, value}[]
         └─ stageInputs: (StageInput | null)[]   // indexed by shader stage
            ├─ constants: Constant[]
            ├─ resources / uavs: Resource[]
            ├─ samplers: Sampler[]
            ├─ signature: { pipelineInputs, registers, threadGroupSize }
            └─ bytecode: ShaderBytecode | null    // opaque bytes; hand to @carbonenginejs/reader-dxbc
```

By default `effect` resolves the permutation's *default* option set (Carbon's
own default-permutation rule). Pick a different one with the `permutation`
option: `CjsHlslReader.read(bytes, { permutation: [{ name: "BLEND_MODE", value: "TRANSPARENT" }] })`
(also accepts a `Map`), forwarded to the same resolution Carbon's own
`Tr2EffectRes.GetShader` uses.

### `emit: "raw"`

Returns the internal `Tr2EffectRes` instance directly. This is **unstable,
not schema-guaranteed** — it exists for callers who need to resolve more
than one permutation from a single loaded effect (`effect.GetShader(options)`)
without re-parsing. Prefer the JSON graph for anything you persist or feed
into other packages.

### `Inspect(bytes)`

A cheaper alternative to a full `Read`: header facts plus the resolved
permutation's technique names, pass counts and per-pass active-stage counts,
without building the full JSON graph.

## Class hydration (`classes` option)

`CjsHlslReader` exports no model classes, but a caller can register
constructors for specific node kinds in the JSON graph; matching nodes are
instantiated with `new` and populated with that node's usual fields instead
of a plain object literal:

```js
import CjsHlslReader from "@carbonenginejs/reader-hlsl";

CjsHlslReader.CLASS_KEYS;
// ["Root", "Permutation", "EffectDescription", "Technique", "Pass",
//  "StageInput", "Constant", "Resource", "Sampler", "ShaderBytecode"]

const result = CjsHlslReader.read(bytes, {
    classes: { Technique: MyTechnique, StageInput: MyStageInput }
});

// or on a reusable profile:
const reader = new CjsHlslReader();
reader.SetClass("Technique", MyTechnique);
reader.SetClasses({ StageInput: MyStageInput });
reader.HasClass("Technique");  // true
reader.GetClass("Technique");  // MyTechnique
```

This is a first-pass hydration surface covering the top-level effect graph.
Nested detail with no dedicated class key yet (shader libraries, parameter
annotations, pipeline-input/register signatures) is still emitted as plain,
JSON-compatible data — see `src/core/json.js` for the exact shape.

## Tests

```sh
npm test
```

Baseline tests are fully self-contained (synthetic effect bytes assembled
in-test, plus binary-reader unit tests) — no game assets, network access or
fixtures required. An optional corpus sweep parses every `.sm_hi` file found
under a local directory of compiled effects:

```sh
HLSL_CORPUS_DIR=path/to/effect.dx11 npm test
```

or via a gitignored `corpus.local.json`: `{ "corpusDir": "path/to/effect.dx11" }`.
Last full sweep: 537 `.sm_hi` files, 593 permutation axes, 949 techniques
decoded, zero failures.

## License

MIT (see `LICENSE` and `NOTICE`).

This package contains no CarbonEngine or Fenris Creations/CCP code. Its Tr2
container layout and data-shape model were reverse-engineered from compiled
effect files, historical GLES shader assets, and observed CarbonEngine
source-code structure. Those sources informed field names and layout
hypotheses; the implementation is original CarbonEngineJS code.
