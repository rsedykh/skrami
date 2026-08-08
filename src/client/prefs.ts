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

export type RecentBoard = { slug: string };

export function recentBoards(): RecentBoard[] {
  try {
    return JSON.parse(localStorage.getItem("skrami:recent") ?? "[]");
  } catch {
    return [];
  }
}

export function touchRecent(slug: string): void {
  const rest = recentBoards().filter((r) => r.slug !== slug);
  localStorage.setItem("skrami:recent", JSON.stringify([{ slug }, ...rest].slice(0, 8)));
}

export function dropRecent(slug: string): void {
  localStorage.setItem("skrami:recent", JSON.stringify(recentBoards().filter((r) => r.slug !== slug)));
}

export function boardToken(slug: string): string | null {
  return localStorage.getItem(`skrami:token:${slug}`);
}

export function setBoardToken(slug: string, token: string | null): void {
  if (token) localStorage.setItem(`skrami:token:${slug}`, token);
  else localStorage.removeItem(`skrami:token:${slug}`);
}

export function boardPassword(slug: string): string {
  return localStorage.getItem(`skrami:pw:${slug}`) ?? "";
}

export function setBoardPassword(slug: string, password: string | null): void {
  if (password) localStorage.setItem(`skrami:pw:${slug}`, password);
  else localStorage.removeItem(`skrami:pw:${slug}`);
}

// Done-column view: 0 = show all, otherwise "last N days"
export function doneDays(slug: string): number {
  return Number(localStorage.getItem(`skrami:done:${slug}`) ?? 0);
}

export function setDoneDays(slug: string, days: number): void {
  if (days) localStorage.setItem(`skrami:done:${slug}`, String(days));
  else localStorage.removeItem(`skrami:done:${slug}`);
}

export function boardFilter(slug: string): string {
  return localStorage.getItem(`skrami:filter:${slug}`) ?? "";
}

export function setBoardFilter(slug: string, name: string): void {
  if (name) localStorage.setItem(`skrami:filter:${slug}`, name);
  else localStorage.removeItem(`skrami:filter:${slug}`);
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

export function applyTheme(): void {
  const t = theme();
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.classList.toggle("light", t === "light");
}

export function effectiveDark(): boolean {
  const t = theme();
  if (t) return t === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
