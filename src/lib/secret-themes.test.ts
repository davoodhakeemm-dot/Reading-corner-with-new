import assert from "node:assert/strict";
import test from "node:test";

import { getSecretTheme, resolveWaterButtonVariant, SECRET_THEMES } from "./secret-themes";

test("emerald theme ID is updated to Liquid Glass iridescent aesthetic", () => {
  const liquid = getSecretTheme("emerald");
  assert.equal(liquid.id, "emerald");
  assert.equal(liquid.name, "Liquid Glass");
  assert.equal(liquid.isDark, false);
  assert.equal(SECRET_THEMES.emerald.swatches.length, 3);
});

test("resolveWaterButtonVariant maps each theme to matching glowing button styles", () => {
  assert.equal(resolveWaterButtonVariant("emerald", "primary"), "liquidViolet");
  assert.equal(resolveWaterButtonVariant("emerald", "secondary"), "liquidAqua");
  assert.equal(resolveWaterButtonVariant("emerald", "surface"), "liquidGlass");

  assert.equal(resolveWaterButtonVariant("instagram", "primary"), "ocean");
  assert.equal(resolveWaterButtonVariant("instagram", "surface"), "surface3d");

  assert.equal(resolveWaterButtonVariant("dark", "primary"), "cobalt");
  assert.equal(resolveWaterButtonVariant("dark", "surface"), "surface3dDark");
});
