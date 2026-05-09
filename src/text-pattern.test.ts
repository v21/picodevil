import { describe, it, expect, beforeEach } from "vitest";
import { text } from "./text-pattern";
import { screen } from "./screen-pattern";
import { mini } from "@strudel/mini";
import { resetRegistry, initRegistry } from "./pattern-registry";
import "./visual-controls";

beforeEach(() => {
  resetRegistry();
  initRegistry();
});

describe("text()", () => {
  it("produces events with _type:'text' and text field", () => {
    const evs = text('hello').queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value._type).toBe('text');
    expect(evs[0].value.text).toBe('hello');
  });

  it("passes multiline strings through unchanged", () => {
    const evs = text('line one\nline two').queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.text).toBe('line one\nline two');
  });

  it("string with spaces is a single literal tile (not alternation)", () => {
    const evs = text('hello world').queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value.text).toBe('hello world');
  });

  it("accepts a Pattern for alternation", () => {
    // When a Pattern is passed (e.g. from transpiled text("a b")), values alternate
    const evs = text(mini('hello world')).queryArc(0, 1);
    expect(evs).toHaveLength(2);
    expect(evs[0].value._type).toBe('text');
    expect(evs[1].value._type).toBe('text');
  });
});

describe("font controls on text()", () => {
  it(".font() sets font field", () => {
    const evs = text('hi').font('IBM Plex Mono').queryArc(0, 1);
    expect(evs[0].value.font).toBe('IBM Plex Mono');
  });

  it(".fontSize() sets fontSize field", () => {
    const evs = text('hi').fontSize(48).queryArc(0, 1);
    expect(evs[0].value.fontSize).toBe(48);
  });

  it(".fontColor() sets fontColor field", () => {
    const evs = text('hi').fontColor('cyan').queryArc(0, 1);
    expect(evs[0].value.fontColor).toBe('cyan');
  });

  it(".fontBGColor() sets fontBGColor field", () => {
    const evs = text('hi').fontBGColor('black').queryArc(0, 1);
    expect(evs[0].value.fontBGColor).toBe('black');
  });

  it(".textColor() is a synonym for .fontColor()", () => {
    const evs = text('hi').textColor('red').queryArc(0, 1);
    expect(evs[0].value.fontColor).toBe('red');
  });

  it(".textColour() is a synonym for .fontColor()", () => {
    const evs = text('hi').textColour('blue').queryArc(0, 1);
    expect(evs[0].value.fontColor).toBe('blue');
  });

  it(".fontColour() is a synonym for .fontColor()", () => {
    const evs = text('hi').fontColour('green').queryArc(0, 1);
    expect(evs[0].value.fontColor).toBe('green');
  });

  it(".textSize() is a synonym for .fontSize()", () => {
    const evs = text('hi').textSize(32).queryArc(0, 1);
    expect(evs[0].value.fontSize).toBe(32);
  });

  it(".textBGColor() is a synonym for .fontBGColor()", () => {
    const evs = text('hi').textBGColor('navy').queryArc(0, 1);
    expect(evs[0].value.fontBGColor).toBe('navy');
  });
});

describe("s() text: prefix syntax", () => {
  it("s('text:hello_world') produces a text event with spaces", () => {
    const evs = screen('text:hello_world').queryArc(0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].value._type).toBe('text');
    expect(evs[0].value.text).toBe('hello world');
  });

  it("s('text:foo:bar') preserves colons in content", () => {
    const evs = screen('text:foo:bar').queryArc(0, 1);
    expect(evs[0].value._type).toBe('text');
    expect(evs[0].value.text).toBe('foo:bar');
  });

  it("s('text:single') with single word works", () => {
    const evs = screen('text:word').queryArc(0, 1);
    expect(evs[0].value._type).toBe('text');
    expect(evs[0].value.text).toBe('word');
  });

  it("text token in s() can be mixed with other tokens", () => {
    // "red text:hello_world" alternates: 2 events per full cycle
    const evs = screen('red text:hello_world').queryArc(0, 1);
    expect(evs).toHaveLength(2);
    const types = evs.map((e: any) => e.value._type);
    expect(types).toContain('color');
    expect(types).toContain('text');
  });
});
