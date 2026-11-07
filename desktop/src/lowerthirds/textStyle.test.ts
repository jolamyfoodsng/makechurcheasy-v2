import { describe, expect, it } from "vitest";
import {
  applyHighlightMarkup,
  applyTextCase,
  parseTextStyle,
  serializeTextStyle,
  substituteStyledVariables,
  textStyleCapabilityFor,
} from "./textStyle";

describe("textStyle", () => {
  it("changes letter case", () => {
    expect(applyTextCase("we declare THAT", "upper")).toBe("WE DECLARE THAT");
    expect(applyTextCase("WE DECLARE that", "lower")).toBe("we declare that");
    expect(applyTextCase("WHAT IS faith? it is trust", "title")).toBe("What Is Faith? It Is Trust");
    expect(applyTextCase("WHAT IS FAITH? IT IS TRUST.", "sentence")).toBe("What is faith? It is trust.");
    expect(applyTextCase("As Typed", "none")).toBe("As Typed");
    expect(applyTextCase("Have you registered for REVAYAH 2026? Don't wait!", "title")).toBe("Have You Registered For Revayah 2026? Don't Wait!");
    expect(applyTextCase('he said "come" and \'go\'', "title")).toBe('He Said "Come" And \'Go\'');
    expect(applyTextCase("Have you registered? DON'T WAIT! register today.", "sentence")).toBe("Have you registered? Don't wait! Register today.");
  });

  it("round-trips and clamps the style string", () => {
    const s = parseTextStyle("case=upper;size=500;weight=bold;italic=1;spacing=wide");
    expect(s).toEqual({ case: "upper", size: 180, weight: "bold", italic: true, spacing: "wide" });
    expect(serializeTextStyle(parseTextStyle(""))).toBe("");
    expect(parseTextStyle("{{title__style}}").case).toBe("none");
  });

  it("styles text but only changes the case inside attributes", () => {
    const html = '<div data-v-title="{{title}}"><b>{{title}}</b><i>{{other}}</i></div>';
    const out = substituteStyledVariables(html, { title: "grace & peace", title__style: "case=upper;size=120", other: "x" });
    expect(out).toContain('data-v-title="GRACE &amp; PEACE"');
    expect(out).toContain('<b><span class="lt-ts" style="text-transform:none!important;font-size:120%!important">GRACE &amp; PEACE</span></b>');
    expect(out).toContain("<i>x</i>");
  });

  it("knows which graphics take the full style", () => {
    expect(textStyleCapabilityFor({ html: '<div class="kx-root" data-kx-pkg="abc">' })).toBe("full");
    expect(textStyleCapabilityFor({ html: '<div class="kx-root" data-kx="x">' })).toBe("case");
    expect(textStyleCapabilityFor({ html: "<div>{{name}}</div>" })).toBe("full");
  });

  it("turns *word* and *[#hex]word* into bold/coloured <strong> markup", () => {
    expect(applyHighlightMarkup("grace and *truth*")).toBe('grace and <strong class="lt-em">truth</strong>');
    expect(applyHighlightMarkup("he is *[#facc15]risen*!")).toBe('he is <strong class="lt-em" style="color:#facc15">risen</strong>!');
    expect(applyHighlightMarkup("no markup here")).toBe("no markup here");
  });

  it("applies the *word* highlight markup to a quote field in text content, never inside an attribute", () => {
    const html = '<div data-v-quote="{{quote}}"><p>{{quote}}</p></div>';
    const out = substituteStyledVariables(html, { quote: "This is the day *the Lord* has made." });
    // The attribute keeps the raw markup untouched — real <strong> tags there would break its quoting.
    expect(out).toContain('data-v-quote="This is the day *the Lord* has made."');
    // The text content gets the real, escaped-safe <strong> markup.
    expect(out).toContain('<p>This is the day <strong class="lt-em">the Lord</strong> has made.</p>');
  });
});
