import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { image } from "./image-pattern";
import "./visual-controls";

describe("image()", () => {
  it("returns src events from queryArc", () => {
    const evs = image("a.png").queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.src).toBe("a.png");
    expect(evs[0].value._type).toBe("image");
  });

  it("multiple src events in one cycle", () => {
    const evs = image("a.png b.jpg c.gif").queryArc(0, 1);
    expect(evs).toHaveLength(3);
    expect(evs.map((e: any) => e.value.src)).toEqual(["a.png", "b.jpg", "c.gif"]);
  });

  it("queryArc at mid-cycle returns correct src", () => {
    const evs = image("a.png b.png").queryArc(0.5, 0.5);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.src).toBe("b.png");
  });

  it("urlBase() merges into events", () => {
    const evs = image("a.png").urlBase("https://example.com/imgs/").queryArc(0, 1);
    expect(evs[0].value.urlBase).toBe("https://example.com/imgs/");
  });

  it("urlBase() preserves src", () => {
    const evs = image("a.png b.png").urlBase("https://x.com/").queryArc(0, 1);
    expect(evs).toHaveLength(2);
    expect(evs[0].value.src).toBe("a.png");
  });

  it("alpha() merges into events", () => {
    const evs = image("a.png").alpha(0.5).queryArc(0, 1);
    expect(evs[0].value.alpha).toBe(0.5);
  });

  it("objectfit() merges into events", () => {
    const evs = image("a.png").objectfit("contain").queryArc(0, 1);
    expect(evs[0].value.objectfit).toBe("contain");
  });

  it("scale() sets both scaleX and scaleY", () => {
    const evs = image("a.png").scale(3).queryArc(0, 1);
    expect(evs[0].value.scaleX).toBe(3);
    expect(evs[0].value.scaleY).toBe(3);
  });

  it("chaining preserves all controls", () => {
    const evs = image("a.png").urlBase("https://x.com/").alpha(0.5).scale(2).queryArc(0, 1);
    expect(evs[0].value.src).toBe("a.png");
    expect(evs[0].value._type).toBe("image");
    expect(evs[0].value.urlBase).toBe("https://x.com/");
    expect(evs[0].value.alpha).toBe(0.5);
    expect(evs[0].value.scaleX).toBe(2);
    expect(evs[0].value.scaleY).toBe(2);
  });
});
