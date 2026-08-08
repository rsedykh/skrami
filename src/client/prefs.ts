export function clientId(): string {
  let id = localStorage.getItem("skrami:client");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("skrami:client", id);
  }
  return id;
}

export function myName(): string {
  return localStorage.getItem("skrami:name") ?? "";
}

export function setMyName(name: string): void {
  localStorage.setItem("skrami:name", name);
}

export type RecentBoard = { id: string; name: string };

export function recentBoards(): RecentBoard[] {
  try {
    const list = JSON.parse(localStorage.getItem("skrami:recent") ?? "[]") as RecentBoard[];
    return list.filter((r) => typeof r?.id === "string" && r.id);
  } catch {
    return [];
  }
}

// also the rename hook: re-touching with a new name updates the drawer entry
export function touchRecent(id: string, name: string): void {
  const rest = recentBoards().filter((r) => r.id !== id);
  localStorage.setItem("skrami:recent", JSON.stringify([{ id, name }, ...rest].slice(0, 8)));
}

export function dropRecent(id: string): void {
  localStorage.setItem("skrami:recent", JSON.stringify(recentBoards().filter((r) => r.id !== id)));
}

export function boardToken(id: string): string | null {
  return localStorage.getItem(`skrami:token:${id}`);
}

export function setBoardToken(id: string, token: string | null): void {
  if (token) localStorage.setItem(`skrami:token:${id}`, token);
  else localStorage.removeItem(`skrami:token:${id}`);
}

export function boardPassword(id: string): string {
  return localStorage.getItem(`skrami:pw:${id}`) ?? "";
}

export function setBoardPassword(id: string, password: string | null): void {
  if (password) localStorage.setItem(`skrami:pw:${id}`, password);
  else localStorage.removeItem(`skrami:pw:${id}`);
}

// Done-column view: 0 = show all, otherwise "last N days"
export function doneDays(id: string): number {
  return Number(localStorage.getItem(`skrami:done:${id}`) ?? 0);
}

export function setDoneDays(id: string, days: number): void {
  if (days) localStorage.setItem(`skrami:done:${id}`, String(days));
  else localStorage.removeItem(`skrami:done:${id}`);
}

export function boardFilter(id: string): string {
  return localStorage.getItem(`skrami:filter:${id}`) ?? "";
}

export function setBoardFilter(id: string, name: string): void {
  if (name) localStorage.setItem(`skrami:filter:${id}`, name);
  else localStorage.removeItem(`skrami:filter:${id}`);
}

// theme: "" = follow system, "dark" | "light" = per-device override
export function theme(): string {
  return localStorage.getItem("skrami:theme") ?? "";
}

export function setTheme(t: string): void {
  if (t) localStorage.setItem("skrami:theme", t);
  else localStorage.removeItem("skrami:theme");
  applyTheme();
}

function applyTheme(): void {
  const t = theme();
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.classList.toggle("light", t === "light");
}

export function effectiveDark(): boolean {
  const t = theme();
  if (t) return t === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
