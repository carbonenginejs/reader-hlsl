export { CjsFormatHlsl, default } from "./CjsFormatHlsl.js";

// Advanced/unstable exports: internal Tr2 effect-graph pieces for tooling
// that needs more than the documented JSON contract (e.g. building a
// binding manifest from a raw-emitted EffectDescription). These are not
// part of the stable public API - CjsFormatHlsl (emit: "json", the
// default) is the supported surface for everyone else. May change
// shape without a major version bump.
export { readEffectAnalysis } from "./core/analysis.js";
export { Tr2EffectBindingManifest } from "./core/tr2/shader/Tr2EffectBindingManifest.js";
export { Tr2RenderContextEnum, tr2ShaderStageName } from "./core/tr2/Tr2RenderContextEnum.js";
