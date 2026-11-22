export class SessionCookieJar {
  private cookies = new Map<string, string>();

  constructor(rawCookieHeader: string) {
    this.parseAndMerge(rawCookieHeader);
  }

  private parseAndMerge(cookieStr: string) {
    if (!cookieStr || cookieStr.trim() === "VALUES") return;

    for (const part of cookieStr.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;

      const name = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      this.cookies.set(name, value);
    }
  }

  ingestSetCookieHeaders(setCookieList: string[]): string[] {
    const updatedNames: string[] = [];

    for (const raw of setCookieList) {
      const firstPair = raw.split(";")[0]?.trim();
      if (!firstPair) continue;
      const eqIdx = firstPair.indexOf("=");
      if (eqIdx <= 0) continue;

      const name = firstPair.slice(0, eqIdx).trim();
      const value = firstPair.slice(eqIdx + 1).trim();
      if (this.cookies.get(name) !== value) {
        this.cookies.set(name, value);
        updatedNames.push(name);
      }
    }

    return updatedNames;
  }

  toCookieHeader(): string {
    if (this.cookies.size === 0) return "VALUES";
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  hasRealCookies(): boolean {
    return this.cookies.size > 0;
  }
}
