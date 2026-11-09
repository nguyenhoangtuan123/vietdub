import Link from "next/link";
import { Logo } from "./Icons";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <Logo />
          <span className="text-lg">VietDub</span>
        </Link>
        <p className="hidden text-sm text-muted sm:block">Lồng tiếng Việt cho video Trung Quốc</p>
      </div>
    </header>
  );
}
