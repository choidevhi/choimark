// Plugins without bundled types. markdown-it 15 ships its own types but no
// plugin helper types, so the plugin signature is spelled out here.

declare module "markdown-it-mark" {
  import type { MarkdownIt } from "markdown-it";

  export default function plugin(md: MarkdownIt): void;
}

declare module "markdown-it-sub" {
  import type { MarkdownIt } from "markdown-it";

  export default function plugin(md: MarkdownIt): void;
}

declare module "markdown-it-sup" {
  import type { MarkdownIt } from "markdown-it";

  export default function plugin(md: MarkdownIt): void;
}

declare module "markdown-it-deflist" {
  import type { MarkdownIt } from "markdown-it";

  export default function plugin(md: MarkdownIt): void;
}

declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";

  export default function plugin(md: MarkdownIt): void;
}

declare module "markdown-it-front-matter" {
  import type { MarkdownIt } from "markdown-it";

  export default function plugin(md: MarkdownIt, callback: (frontMatter: string) => void): void;
}

declare module "markdown-it-emoji" {
  import type { MarkdownIt } from "markdown-it";

  export function full(md: MarkdownIt): void;
  export function light(md: MarkdownIt): void;
  export function bare(md: MarkdownIt): void;
}

declare module "@vscode/markdown-it-katex" {
  import type { MarkdownIt } from "markdown-it";

  interface KatexPluginOptions {
    enableBareBlocks?: boolean;
    enableMathBlockInHtml?: boolean;
    enableMathInlineInHtml?: boolean;
    enableFencedBlocks?: boolean;
    throwOnError?: boolean;
    trust?: boolean;
    strict?: boolean | string;
    output?: "html" | "mathml" | "htmlAndMathml";
  }

  type KatexPlugin = (md: MarkdownIt, options?: KatexPluginOptions) => void;

  // CommonJS with `exports.default`: depending on the bundler's interop the
  // default import is the function or the whole exports object.
  const plugin: KatexPlugin | { default: KatexPlugin };
  export default plugin;
}
