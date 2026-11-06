import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RootLayout from "../app/layout";
import SamaritanPage from "../app/samaritan/page";

const APP_ROOT = path.resolve(__dirname, "..");
const PAGE_CHROME_TAGS = /<(header|nav|footer|article|aside)\b/i;

describe("routes render a bare full-scene player", () => {
  it.each([
    ["samaritan", SamaritanPage],
  ] as const)("/%s has stable markers and no page chrome DOM", async (world, Page) => {
    const html = renderToStaticMarkup(
      <RootLayout>{await Page({ searchParams: Promise.resolve({ mode: "reference", t: "1.5" }) })}</RootLayout>,
    );
    expect(html).toContain(`data-world="${world}"`);
    expect(html).toContain('data-mode="reference"');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('data-time=""');
    expect(html).toContain('class="ref-player"');
    expect(html).not.toMatch(PAGE_CHROME_TAGS);
    expect(html).not.toContain("data-reference-qa");
    expect(html).not.toMatch(/Built in Layers|Contact|Projects/i);
  });

  it("defaults to interactive mode without any HUD", async () => {
    const html = renderToStaticMarkup(await SamaritanPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-mode="interactive"');
    expect(html).not.toContain("data-reference-qa");
    expect(html).not.toMatch(/<(button|input)\b/);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

describe("shipped source boundaries", () => {
  const shipped = [...sourceFiles(path.join(APP_ROOT, "app")), ...sourceFiles(path.join(APP_ROOT, "src"))];

  it("never imports test fixtures or code outside reference-app", () => {
    for (const file of shipped) {
      const text = readFileSync(file, "utf8");
      const specifiers = [...text.matchAll(/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)].map(
        (m) => m[1] ?? m[2] ?? "",
      );
      for (const spec of specifiers) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/fixture|^@\//);
        if (spec.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), spec);
          expect(resolved.startsWith(APP_ROOT + path.sep), `${file} escapes reference-app via ${spec}`).toBe(true);
        }
      }
    }
  });

  it("adds no post-processing or synthetic camera construction", () => {
    for (const file of shipped) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/EffectComposer|UnrealBloom|BokehPass|new\s+PerspectiveCamera|lookAt\(/);
    }
  });
});
