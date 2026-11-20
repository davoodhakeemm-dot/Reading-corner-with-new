import { Link } from "@tanstack/react-router";
import { BookOpen, Copy } from "lucide-react";
import { toast } from "sonner";

export function ReadingActions({
  personalPath,
  inShell = false,
}: {
  personalPath?: string | null;
  inShell?: boolean;
}) {
  async function copyLink() {
    if (!personalPath) return;
    const url = `${window.location.origin}${personalPath}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Personal link copied");
    } catch {
      window.prompt("Copy your personal link:", url);
    }
  }

  return (
    <div
      className={
        inShell
          ? "relative flex shrink-0 justify-end gap-2 px-4 py-2"
          : "fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex"
      }
    >
      {personalPath && (
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-900 shadow-sm focus-visible:outline-2 focus-visible:outline-violet-500"
        >
          <Copy aria-hidden="true" className="size-4" /> Copy personal link
        </button>
      )}
      <Link
        to="/home"
        replace
        className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-r from-[#7144bb] to-[#a63da4] px-4 text-sm font-semibold text-white shadow-md hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
      >
        <BookOpen aria-hidden="true" className="size-4" /> Go to Reading
      </Link>
    </div>
  );
}
