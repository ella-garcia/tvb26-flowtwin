import { describe, expect, it } from "vitest";
import { publicToken } from "./publicRoute";

describe("publicToken", () => {
  it("reads a reply token from #r/<token>", () => {
    expect(publicToken("#r/abcDEF123_-abcdef12")).toBe("abcDEF123_-abcdef12");
  });
  it("ignores app routes, short tokens and extra path parts", () => {
    expect(publicToken("#risk")).toBeNull();
    expect(publicToken("#r/short")).toBeNull();
    expect(publicToken("#r/abcdefghijklmnop/x")).toBeNull();
    expect(publicToken("")).toBeNull();
  });
});
