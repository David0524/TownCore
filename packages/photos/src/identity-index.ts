// Town logo art (owner, 2026-10-17): ChatGPT prompts, assets cut in code, the import command.
// Its own entry point so the website never bundles the file-writing import code.
export {
  LOGO_PROMPTS,
  LOGO_RULES,
  logoArtPrompt,
  logoInputProblems,
  placeholderLogoArt,
  type LogoArtInput,
} from './identity';
export {
  cutOut,
  deriveIdentityAssets,
  HERO_SIZE,
  IDENTITY_FILES,
  writeIdentityAssets,
  type DerivedAsset,
  type IdentityFile,
  type Region,
} from './identity-assets';
export {
  CHATGPT_LICENSE,
  CHATGPT_SOURCE,
  IdentityImportError,
  importIdentityArt,
  writeArtConfig,
} from './identity-import';
