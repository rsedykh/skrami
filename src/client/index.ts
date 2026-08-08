import { newBoardPath } from "../shared/id";
import { wireDrawer } from "./drawer";
import { effectiveDark, recentBoards, setTheme } from "./prefs";

document.getElementById("create")!.addEventListener("click", () => {
  location.href = newBoardPath();
});
document.getElementById("themetoggle")!.addEventListener("click", () => setTheme(effectiveDark() ? "light" : "dark"));

if (recentBoards().length) document.getElementById("burger")!.hidden = false;
wireDrawer();
if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
