import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { ImagePattern } from "./image-pattern";

function ip(src: string) {
  return ImagePattern.fromSrc(mini(src), mini);
}

describe("ImagePattern", () => {
  it("returns src events from queryArc", () => {
    const evs = ip("a.png").queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.src).toBe("a.png");
  });

  it("multiple src events in one cycle", () => {
    const evs = ip("a.png b.jpg c.gif").queryArc(0, 1);
    expect(evs).toHaveLength(3);
    expect(evs.map(e => e.value.src)).toEqual(["a.png", "b.jpg", "c.gif"]);
  });

  it("queryArc at mid-cycle returns correct src", () => {
    const evs = ip("a.png b.png").queryArc(0.5, 0.501);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.src).toBe("b.png");
  });

  it("urlBase() sets custom base", () => {
    const img = ip("photo.png").urlBase("https://example.com/imgs/");
    expect(img.imageUrlBase).toBe("https://example.com/imgs/");
  });

  it("urlBase() defaults to undefined", () => {
    expect(ip("a.png").imageUrlBase).toBeUndefined();
  });

  it("urlBase() chaining is immutable", () => {
    const p1 = ip("a.png");
    const p2 = p1.urlBase("https://example.com/");
    expect(p1.imageUrlBase).toBeUndefined();
    expect(p2.imageUrlBase).toBe("https://example.com/");
  });

  it("urlBase() preserves src pattern", () => {
    const evs = ip("a.png b.png").urlBase("https://x.com/").queryArc(0, 1);
    expect(evs).toHaveLength(2);
    expect(evs[0].value.src).toBe("a.png");
  });

  it("alpha() merges into events", () => {
    const evs = ip("a.png").alpha("0.5").queryArc(0, 1);
    expect(evs[0].value.alpha).toBe(0.5);
  });

  it("opacity() is alias for alpha()", () => {
    const evs = ip("a.png").opacity("0.7").queryArc(0, 1);
    expect(evs[0].value.alpha).toBeCloseTo(0.7);
  });

  it("alpha() chaining is immutable", () => {
    const p1 = ip("a.png");
    const p2 = p1.alpha("0.5");
    expect(p1.queryArc(0, 1)[0].value.alpha).toBeUndefined();
    expect(p2.queryArc(0, 1)[0].value.alpha).toBe(0.5);
  });

  it("alpha() preserves urlBase", () => {
    const img = ip("a.png").urlBase("https://x.com/").alpha("0.5");
    expect(img.imageUrlBase).toBe("https://x.com/");
    expect(img.queryArc(0, 1)[0].value.alpha).toBe(0.5);
  });

  it("urlBase() preserves alpha", () => {
    const img = ip("a.png").alpha("0.5").urlBase("https://x.com/");
    expect(img.imageUrlBase).toBe("https://x.com/");
    expect(img.queryArc(0, 1)[0].value.alpha).toBe(0.5);
  });

  it("fit() sets fit mode", () => {
    expect(ip("a.png").fit("contain").fitMode).toBe("contain");
    expect(ip("a.png").fit("fill").fitMode).toBe("fill");
    expect(ip("a.png").fit("none").fitMode).toBe("none");
    expect(ip("a.png").fit("cover").fitMode).toBe("cover");
  });

  it("fit() defaults to cover", () => {
    expect(ip("a.png").fitMode).toBe("cover");
  });

  it("fit() chaining is immutable", () => {
    const p1 = ip("a.png");
    const p2 = p1.fit("contain");
    expect(p1.fitMode).toBe("cover");
    expect(p2.fitMode).toBe("contain");
  });

  it("fit() preserves urlBase and alpha", () => {
    const img = ip("a.png").urlBase("https://x.com/").alpha("0.5").fit("none");
    expect(img.imageUrlBase).toBe("https://x.com/");
    expect(img.queryArc(0, 1)[0].value.alpha).toBe(0.5);
    expect(img.fitMode).toBe("none");
  });

  it("out() calls onOut callback", () => {
    let called: ImagePattern | null = null;
    const img = ImagePattern.fromSrc(mini("a.png"), mini, (p) => { called = p; });
    img.out();
    expect(called).toBe(img);
  });

  it("out() after chaining passes the chained instance", () => {
    let called: ImagePattern | null = null;
    const img = ImagePattern.fromSrc(mini("a.png"), mini, (p) => { called = p; });
    const chained = img.urlBase("https://x.com/").alpha("0.5").fit("contain");
    chained.out();
    expect(called).toBe(chained);
    expect(called!.imageUrlBase).toBe("https://x.com/");
    expect(called!.fitMode).toBe("contain");
  });

  it("scaleX() merges into events", () => {
    const evs = ip("a.png").scaleX("2").queryArc(0, 1);
    expect(evs[0].value.scaleX).toBe(2);
  });

  it("scaleY() merges into events", () => {
    const evs = ip("a.png").scaleY("0.5").queryArc(0, 1);
    expect(evs[0].value.scaleY).toBe(0.5);
  });

  it("scale() sets both scaleX and scaleY", () => {
    const evs = ip("a.png").scale("3").queryArc(0, 1);
    expect(evs[0].value.scaleX).toBe(3);
    expect(evs[0].value.scaleY).toBe(3);
  });

  it("scale() overrides earlier scaleX/scaleY", () => {
    const evs = ip("a.png").scaleX("2").scaleY("4").scale("1").queryArc(0, 1);
    expect(evs[0].value.scaleX).toBe(1);
    expect(evs[0].value.scaleY).toBe(1);
  });

  it("scaleX() after scale() only overrides X", () => {
    const evs = ip("a.png").scale("3").scaleX("5").queryArc(0, 1);
    expect(evs[0].value.scaleX).toBe(5);
    expect(evs[0].value.scaleY).toBe(3);
  });

  it("scale chaining is immutable", () => {
    const p1 = ip("a.png");
    const p2 = p1.scale("2");
    expect(p1.queryArc(0, 1)[0].value.scaleX).toBeUndefined();
    expect(p2.queryArc(0, 1)[0].value.scaleX).toBe(2);
  });

  it("scale preserves urlBase and alpha", () => {
    const img = ip("a.png").urlBase("https://x.com/").alpha("0.5").scale("2");
    expect(img.imageUrlBase).toBe("https://x.com/");
    expect(img.queryArc(0, 1)[0].value.alpha).toBe(0.5);
    expect(img.queryArc(0, 1)[0].value.scaleX).toBe(2);
  });
});
