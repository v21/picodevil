import { describe, it, expect, beforeEach } from "vitest";
import { screen, s } from "./screen-pattern";
import { addMedia, clearAll } from "./media-registry";
import { color } from "./color-pattern";
import { video } from "./video-pattern";
import { image } from "./image-pattern";
import "./visual-controls";

beforeEach(() => {
  clearAll();
});

describe("screen()", () => {
  it("s is an alias for screen", () => {
    expect(s).toBe(screen);
  });

  describe("registry resolution", () => {
    it("resolves a registry video name", () => {
      addMedia("http://localhost:3456/videos/clip.mp4", "myclip");
      const evs = screen("myclip").queryArc(0, 1);
      expect(evs).toHaveLength(1);
      expect(evs[0].value._type).toBe("video");
      expect(evs[0].value.src).toBe("myclip");
    });

    it("resolves a registry image name", () => {
      addMedia("http://localhost:3456/images/photo.png", "myphoto");
      const evs = screen("myphoto").queryArc(0, 1);
      expect(evs[0].value._type).toBe("image");
      expect(evs[0].value.src).toBe("myphoto");
    });

    it("registry takes priority over extension detection", () => {
      // name has no extension, but registry says it's an image
      addMedia("http://localhost:3456/images/photo.png", "mytoken");
      const evs = screen("mytoken").queryArc(0, 1);
      expect(evs[0].value._type).toBe("image");
    });
  });

  describe("extension fallback", () => {
    it("detects video extension", () => {
      const evs = screen("clip.mp4").queryArc(0, 1);
      expect(evs[0].value._type).toBe("video");
      expect(evs[0].value.src).toBe("clip.mp4");
    });

    it("detects image extension", () => {
      const evs = screen("photo.jpg").queryArc(0, 1);
      expect(evs[0].value._type).toBe("image");
      expect(evs[0].value.src).toBe("photo.jpg");
    });

    it("detects webm as video", () => {
      const evs = screen("something.webm").queryArc(0, 1);
      expect(evs[0].value._type).toBe("video");
    });

    it("detects png as image", () => {
      const evs = screen("logo.png").queryArc(0, 1);
      expect(evs[0].value._type).toBe("image");
    });
  });

  describe("color fallback", () => {
    it("treats unknown tokens as color", () => {
      const evs = screen("red").queryArc(0, 1);
      expect(evs[0].value._type).toBe("color");
      expect(evs[0].value.color).toBe("red");
    });

    it("treats hex codes as color", () => {
      const evs = screen("#ff00ff").queryArc(0, 1);
      expect(evs[0].value._type).toBe("color");
      expect(evs[0].value.color).toBe("#ff00ff");
    });
  });

  describe("mixed pattern", () => {
    it("cycles through different types", () => {
      addMedia("http://localhost:3456/videos/clip.mp4", "myclip");
      const evs = screen("myclip red").queryArc(0, 1);
      expect(evs).toHaveLength(2);
      const types = evs.map((e: any) => e.value._type);
      expect(types).toContain("video");
      expect(types).toContain("color");
    });
  });

  describe("pass-through already-typed patterns", () => {
    it("passes through color() pattern unchanged", () => {
      const evs = screen(color("red blue")).queryArc(0, 1);
      expect(evs).toHaveLength(2);
      expect(evs[0].value._type).toBe("color");
      expect(evs[0].value.color).toBe("red");
    });

    it("passes through video() pattern unchanged", () => {
      const evs = screen(video("clip.mp4")).queryArc(0, 1);
      expect(evs[0].value._type).toBe("video");
      expect(evs[0].value.src).toBe("clip.mp4");
    });

    it("passes through image() pattern unchanged", () => {
      const evs = screen(image("photo.png")).queryArc(0, 1);
      expect(evs[0].value._type).toBe("image");
      expect(evs[0].value.src).toBe("photo.png");
    });
  });

  describe("controls", () => {
    it("alpha() merges into events", () => {
      addMedia("http://localhost:3456/videos/clip.mp4", "myclip");
      const evs = screen("myclip").alpha(0.5).queryArc(0, 1);
      expect(evs[0].value.alpha).toBe(0.5);
    });
  });
});
