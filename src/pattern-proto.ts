import { reify } from "@strudel/core";

/** Shared reference to Pattern.prototype, used for monkey-patching methods. */
export const PatternProto = Object.getPrototypeOf(reify(0));
