# @carbonenginejs/format-hlsl

Pure-JavaScript CarbonEngineJS-facing reader for CCP's Tr2 compiled effect
container format. No native tooling, no build step; it runs in Node and the
browser.

The Tr2 effect container is a Carbon/Trinity format, not a Microsoft one —
this package has no DXBC/instruction-decoding vocabulary. It parses the
effect header (version, string table, permutation axes and compiled-body
offsets) and, per resolved permutation, the technique/pass table and
per-stage constant, resource, sampler and render-state metadata. Shader
bytecode bodies stay as opaque bytes; decoding DXBC/HLSL bytecode itself is
`@carbonenginejs/format-dxbc`'s job, not this package's — `@carbonenginejs/format-hlsl` has zero dependency
on it.

CarbonEngine and Fenris Creations (CCP Games) are named in this package because
the Tr2 container shape was reverse-engineered for Carbon/Trinity effect
interoperability. This package is not affiliated with or endorsed by CCP Games.

## Package

- npm: <https://www.npmjs.com/package/@carbonenginejs/format-hlsl>
- package: `@carbonenginejs/format-hlsl`
- version: `0.1.1`
- license: `MIT`
- runtime: Node `>=18`, modern browsers
- module: ESM, package root exports `CjsFormatHlsl`

## Install

```sh
npm install @carbonenginejs/format-hlsl
```

## Public API

The package root exports one public class: `CjsFormatHlsl`. The `Cjs`
prefix marks this as a CarbonEngineJS format/construction boundary, not an
engine runtime class.

**The public contract is data, not classes.** `CjsFormatHlsl` exports no
Tr2/effect model classes. The Tr2 container parser is internal machinery
under `src/core/tr2` (not part of this package's public surface — do not
import from it). The documented JSON graph shape below is what callers
should depend on.

```js
import CjsFormatHlsl from "@carbonenginejs/format-hlsl";

const reader = new CjsFormatHlsl({
    emit: "json",              // "json" (default) | "metadata" | "raw"
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
const metadata = reader.Read(bytes, { emit: "metadata" });
const text = JSON.stringify(reader.ToJSON(json));

CjsFormatHlsl.isSupported(bytes);             // cheap header-only load check
CjsFormatHlsl.read(bytes, { emit: "raw" });   // internal Tr2EffectRes graph (unstable)
CjsFormatHlsl.read(bytes, { emit: "metadata" }); // metadata-only JSON, no bytecode
await CjsFormatHlsl.readFile("effect.sm_hi"); // Node-only convenience, same emit rules
```

The named export is the same class for callers that prefer named imports:

```js
import { CjsFormatHlsl } from "@carbonenginejs/format-hlsl";
```

Advanced/unstable named exports are also available for tooling that needs one
parse plus one permutation/manifest pass without changing the stable reader
emits:

```js
import {
    readEffectAnalysis,
    Tr2EffectBindingManifest
} from "@carbonenginejs/format-hlsl";

const analysis = readEffectAnalysis(bytes, {
    source: "effect.sm_hi",
    permutation: [ { name: "BLEND_MODE", value: "TRANSPARENT" } ]
});

analysis.selection.bodyIndex;
analysis.bindingManifest instanceof Tr2EffectBindingManifest;
```

`readEffectAnalysis(...)` is an advanced helper and may change shape without a
major version bump. It returns the loaded `Tr2EffectRes`, resolved `Tr2Shader`,
selected-option/body-index data, resolved effect description, and a
`Tr2EffectBindingManifest`. The stable `emit: "metadata"` contract remains
bytecode-free by design.

## Reader Rules

- The package root exports one public format class: `CjsFormatHlsl`.
- Instance methods are PascalCase because reader instances can hydrate or sit
  beside CarbonClasses without colliding with camelCase data fields.
- Static one-shot methods are camelCase because they live on `CjsFormatHlsl`
  itself, not on hydrated CarbonClass instances.
- `src/CjsFormatHlsl.js` is the public format boundary. Parser machinery lives
  under `src/core`; transient CarbonEngine/library-shaped helpers live under
  `src/carbon` until they move to standalone core packages.
- `Read` / static `read` return JSON by default. `emit: "metadata"` returns
  shader inspection JSON for one resolved permutation: options, techniques,
  passes, stage constants, resources, UAVs, samplers, pass render states and
  signatures, without bytecode, constant value bytes or runtime handles.
- `emit: "raw"` exposes the internal `Tr2EffectRes` graph for advanced callers
  and is not a stable schema.
- `ToJSON` / static `toJSON` converts format output to JSON-compatible data. It
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
            └─ bytecode: ShaderBytecode | null    // opaque bytes; hand to @carbonenginejs/format-dxbc
```

By default `effect` resolves the permutation's *default* option set (Carbon's
own default-permutation rule). Pick a different one with the `permutation`
option: `CjsFormatHlsl.read(bytes, { permutation: [{ name: "BLEND_MODE", value: "TRANSPARENT" }] })`
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

### `emit: "metadata"`

The shader endpoint shape: plain JSON for inspection and downstream pipeline
planning, not Trinity runtime classes. Pass render states are retained as
Carbon/D3D numeric key/value pairs with readable names added.

```
MetadataRoot
├─ version, compilerVersion, sourcePath, bodyCount, loadError
├─ permutations: Permutation[]        // axes and default values
├─ bodyIndex                          // compiled body selected by the options
├─ selectedOptions: Option[]          // default/local/global option choice per axis
└─ effect: MetadataEffect | null      // null when the selected body cannot decode
   └─ techniques: Technique[]
      └─ passes: Pass[]
         ├─ renderStates: RenderState[]
         └─ stageInputs: (StageInput | null)[]
            ├─ constantValueSize
            ├─ constants: Constant[]  // name, offset, size, type, dimension, elements
            ├─ resources / uavs: Resource[]
            ├─ samplers: Sampler[]
            ├─ annotations
            └─ signature: { pipelineInputs, registers, samplers, threadGroupSize }
```

`RenderState` keeps the original numeric `key` and `value`, then adds fields
such as `name`, `valueName`, `valueFloat`, `valueHex`, or `valueFlags` when
the state type is known.

Pick a non-default permutation with the same `permutation` option used by
`Read`:

```js
const metadata = CjsFormatHlsl.read(bytes, {
    emit: "metadata",
    permutation: [
        { name: "BLEND_MODE", value: "TRANSPARENT" }
    ]
});
```

## CLI

The package also installs a small Node CLI:

```sh
format-hlsl metadata path/to/effect.fx11
format-hlsl metadata path/to/effect.fx11 path/to/effect.json
```

From this repo/package, the same command is available through npm:

```sh
npm run metadata -- path/to/effect.fx11
npm run metadata -- path/to/effect.fx11 path/to/effect.json
```

When the output path is omitted, the CLI writes `<input-name>.json` in the
current working directory.

## Class hydration (`classes` option)

`CjsFormatHlsl` exports no model classes, but a caller can register
constructors for specific node kinds in the JSON graph; matching nodes are
instantiated with `new` and populated with that node's usual fields instead
of a plain object literal:

```js
import CjsFormatHlsl from "@carbonenginejs/format-hlsl";

CjsFormatHlsl.CLASS_KEYS;
// ["Root", "Permutation", "EffectDescription", "Technique", "Pass",
//  "StageInput", "Constant", "Resource", "Sampler", "ShaderBytecode"]

const result = CjsFormatHlsl.read(bytes, {
    classes: { Technique: MyTechnique, StageInput: MyStageInput }
});

// or on a reusable profile:
const reader = new CjsFormatHlsl();
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
under the directory supplied by `HLSL_CORPUS_DIR`:

```sh
HLSL_CORPUS_DIR=path/to/effect.dx11 npm test
```

Last full sweep: 537 `.sm_hi` files, 593 permutation axes, 949 techniques
decoded, zero failures.

## License

MIT (see `LICENSE` and `NOTICE`).

This package contains no CarbonEngine or Fenris Creations (CCP Games) code. Its
Tr2 container layout and data-shape model were reverse-engineered from compiled
effect files, historical GLES shader assets, and observed CarbonEngine
source-code structure. Those sources informed field names and layout
hypotheses; the implementation is original CarbonEngineJS code.
