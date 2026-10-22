import { describe, expect, test } from "bun:test";
import { displayHeadline } from "../../src/lib/headline.ts";

describe("displayHeadline", () => {
  test("drops an Update marker the model wrote into an update's headline", () => {
    expect(displayHeadline({ headline: "Update: Fondo E: Rau tells people to wait", is_update: true })).toBe(
      "Fondo E: Rau tells people to wait",
    );
    expect(displayHeadline({ headline: "UPDATE — Senate session moved (update)", is_update: true })).toBe(
      "Senate session moved",
    );
  });

  test("leaves other headlines alone", () => {
    expect(displayHeadline({ headline: "Update: not flagged as an update", is_update: false })).toBe(
      "Update: not flagged as an update",
    );
    expect(displayHeadline({ headline: "Updates to the PHP release process", is_update: true })).toBe(
      "Updates to the PHP release process",
    );
    expect(displayHeadline({ headline: "Update:", is_update: true })).toBe("Update:");
  });
});
