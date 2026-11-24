import { Playbooks } from "../plugins/context-engine/playbooks.mjs";
const pb = new Playbooks(new URL("../playbooks.json", import.meta.url).pathname, new URL("../state/playbook-vectors.json", import.meta.url).pathname);
pb.refresh();
await new Promise((r) => setTimeout(r, 200));
if (pb.embedding) await pb.embedding;
const cases = [
  ["i have a book open fullscreen in brave, take screenshots of each page 1 by 1 and make a pdf", "capture-pages"],
["save every slide of this online presentation as images", "capture-pages"],
["make a deep scan online to prepare a list of all the embassies present in egypt with their respective emails", "contact-list"],
["find the emails of all the private universities in cairo", "contact-list"],
["open youtube in brave and play a lofi music video", "browser-task"],
  ["go to my school portal website and download my grades pdf", "browser-task"],
  ["use firefox to search for cheap flights to cairo", "browser-task"],
  ["make a powerpoint about climate change with 8 slides", "documents"],
  ["create a word document report from my notes folder", "documents"],
  ["build an excel sheet comparing ram prices", "documents"],
  ["create for me the most professional data analysis research with 20+ pages using info from this folder /home/u/Desktop/work", "data-analysis"],
  ["analyze my sales csv and tell me which month dropped and why", "data-analysis"],
  ["write a report on the insights from my power bi dashboard exports", "data-analysis"],
  ["what do these survey results show? give me the main statistics", "data-analysis"],
  ["add a jump animation to my godot player script", "change-code"],
  ["my discord stream lags when i play warframe", "own-machine"],
  ["which is better for my laptop, 8gb or 16gb ram", "research"],
  ["the build fails with undefined is not a function", "fix-bug"],
  ["The cart totals in this project are wrong, customers are getting the wrong price. Fix it.", "fix-bug"],
  ["what is the price of a crucial 8gb ddr4 stick in egypt", "research"],
  ["where can i buy a ryzen 5 7500x3d in cairo", "research"],
  ["the function returns the wrong total when the cart is empty", "fix-bug"],
  ["conduct a test on all the installed browsers on my system and rank them to be by the one that uses the least resources from my device and any other aspects too", "measure"],
  ["which of my terminal apps uses less ram, kitty or foot", "measure"],
  ["benchmark the startup time of vscode and zed on this laptop", "measure"],
  ["which browser on my pc is the lightest to keep open all day", "measure"],
  ["setup for me this dotfile https://github.com/pctrade/end4-pC make sure you properly set it up and accurately. and then debug it and to optimize it and make sure that it works, then tell me how to launch it from the tty", "own-machine"],
  ["i am currently in hyprland and the dotfile is not loaded", "own-machine"],
  ["still after the reboot it did not load. make sure you deeply and carefully scan the whole setup and fix it", "own-machine"],
  ["i am currently in emergency mode emergency", "own-machine"],
  ["install hyprland and set it up with waybar", "own-machine"],
  ["write a script that sorts rice varieties by price", "change-code", "own-machine"],
  ["convert my book.docx into a pdf", "documents", "capture-pages"],
  ["email my teacher a summary of the homework", null],
  ["tell me a joke", null],
  ["set the price field to 0 by default in the form", "change-code"],
  ["what does the word ephemeral mean", null],
  ["summarize this paragraph for me", null],
  ["thanks that worked", null],
  ["translate hello into arabic", null],
  ["what's 15% of 3350", null],
  ["explain how a cpu cache works", null],
  ["store this in memory: i prefer dark themes", null],
  ["write a short story about a dragon", null],
  ["analyze why my python script is slow", "fix-bug"],
];
let ok = 0, fp = 0;
for (const [t, want, never] of cases) {
  const r = await pb.select(t, "build");
  const got = r.ids;
  const good = (want ? got.includes(want) : got.length === 0) && !(never && got.includes(never));
  if (good) ok++; else if (!want) fp++;
  console.log(good ? "ok  " : "MISS", JSON.stringify(t).padEnd(70), "->", r.why.join(",") || "-", want ? `(want ${want})` : "");
}
console.log(`\n${ok}/${cases.length} right, ${fp} unrelated prompt(s) got a playbook`);
