// bun test tests/apps.test.mjs: installed-app names make a change request an own-machine task.
import { test, expect } from "bun:test";
import { appsIn } from "../plugins/context-engine/apps.mjs";

const NAMES = ["discord", "vesktop", "steam", "firefox"];
test("named installed apps are found; everyday and programming words are not app names", () => {
  expect(appsIn("Fix Discord and Vesktop so that I can screenshare", NAMES)).toEqual(["discord", "vesktop"]);
  expect(appsIn("fix the bug in my python script", NAMES)).toEqual([]);
  expect(appsIn("the steamroller is broken", NAMES)).toEqual([]);
  expect(appsIn("install a theme for Firefox.", NAMES)).toEqual(["firefox"]);
});
