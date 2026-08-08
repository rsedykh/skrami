import { newBoardPath } from "../shared/id";
import { boardToken, recentBoards } from "./prefs";

const LOCK_ICON =
  '<svg class="dlock" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

export function wireDrawer(currentId?: string): void {
  const burger = document.getElementById("burger")!;
  const drawer = document.getElementById("drawer")!;
  const scrim = document.getElementById("scrim")!;
  const open = () => {
    drawer.classList.add("open");
    scrim.classList.add("open");
  };
  const close = () => {
    drawer.classList.remove("open");
    scrim.classList.remove("open");
  };
  burger.addEventListener("click", open);
  scrim.addEventListener("click", close);
  document.getElementById("dclose")?.addEventListener("click", close);

  const list = document.getElementById("recents")!;
  for (const r of recentBoards()) {
    const a = document.createElement("a");
    a.className = "ditem" + (r.id === currentId ? " current" : "");
    a.href = `/b/${r.name ? `${r.name}-` : ""}${r.id}`;
    a.textContent = r.name || r.id;
    if (boardToken(r.id)) a.insertAdjacentHTML("beforeend", LOCK_ICON);
    list.append(a);
  }
  document.getElementById("newboard")?.addEventListener("click", () => {
    location.href = newBoardPath();
  });
}
