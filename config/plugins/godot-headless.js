// godot-headless: an agent's Godot command never opens a window on the user's desktop.
// 2026-11-25 a model ran `godot -s /tmp/test_voxel.gd` without --headless; Godot showed an "ALERT!" dialog on
// the user's screen and the run waited for someone to click OK. Every `godot` / `godot4` invocation in a shell
// command gets --headless added unless it already has it or explicitly asks for the editor (-e / --editor).
// Off: OPENCODE_NO_GODOT_HEADLESS=1.

// only where a command starts: line start or after && || ; | ( ` $( , optionally behind timeout N / env VAR=x / VAR=x
const GODOT = /((?:^|&&|\|\||[;|(`]|\$\()\s*(?:(?:timeout\s+\S+|env|[A-Za-z_]\w*=\S*)\s+)*)((?:[\w./~-]*\/)?godot4?)(?=\s|$)/g;

/** Add --headless after each godot invocation that lacks it. Returns the command unchanged when nothing applies. */
export function headless(command) {
  if (typeof command !== "string" || !/\bgodot/.test(command)) return command;
  return command.replace(GODOT, (m, pre, exe, offset, whole) => {
    const rest = whole.slice(offset + m.length).split(/(?:&&|\|\||;|\|)/)[0];
    if (/(^|\s)--headless\b/.test(rest) || /(^|\s)(-e|--editor)(\s|$)/.test(rest)) return m;
    return `${pre}${exe} --headless`;
  });
}

export default {
  id: "godot-headless",
  async setup(ctx) {
    if (process.env.OPENCODE_NO_GODOT_HEADLESS === "1") return;
    await ctx?.tool?.hook?.("execute.before", (event) => {
      if (event?.tool !== "shell" || typeof event.input?.command !== "string") return;
      const cmd = headless(event.input.command);
      if (cmd !== event.input.command) event.input = { ...event.input, command: cmd };
    });
  },
};
