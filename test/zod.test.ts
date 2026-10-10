import { describe, expect, test } from "vitest";
import { z } from "zod";
import { typographyRefinement } from "../src/index.ts";

describe("typographyRefinement with Zod 4", () => {
  const schema = z.object({
    language: z.string(),
    subscribed: z.object({ title: z.string() }),
    faq: z.array(z.object({ q: z.string(), a: z.string() })),
  });

  test("reports each issue at its data path", () => {
    const refined = schema.superRefine(typographyRefinement({ locale: "en" }));
    const result = refined.safeParse({
      language: "English",
      subscribed: { title: "You're on the list." },
      faq: [{ q: "Fine?", a: "Yes - {name}'s AI." }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.path.join("."), i.message.split(":")[0]])).toEqual([
      ["subscribed.title", "typography/apostrophe/wrong-glyph"],
      ["faq.0.a", "typography/dash/context-dependent"],
      ["faq.0.a", "typography/apostrophe/wrong-glyph"],
    ]);
    expect(result.error!.issues[0]!.message).toContain('Fix: "’"');
  });

  test("reads the locale from the value", () => {
    const refined = schema.superRefine(
      typographyRefinement({ locale: (v: { language: string }) => (v.language === "Deutsch" ? "de" : "en") }),
    );
    const data = { language: "Deutsch", subscribed: { title: "“Englisch”" }, faq: [] };
    expect(refined.safeParse(data).error?.issues.map((i) => i.path.join("."))).toEqual([
      "subscribed.title",
      "subscribed.title",
    ]);
    expect(refined.safeParse({ ...data, language: "English" }).success).toBe(true);
  });

  test("clean copy passes", () => {
    const refined = schema.superRefine(typographyRefinement({ locale: "en" }));
    expect(
      refined.safeParse({ language: "English", subscribed: { title: "You’re in." }, faq: [] }).success,
    ).toBe(true);
  });
});
