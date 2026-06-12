/**
 * ChatSkeleton — the placeholder shown while a chat's messages load. Shaped like
 * a real thread (user bubbles right, assistant text lines left) and faded in, so
 * opening a chat reads as the thread materializing instead of a centered spinner.
 */
import { Skeleton } from "../../components/ui/Skeleton";

export function ChatSkeleton() {
  return (
    <div className="flex-1 overflow-hidden animate-fade-in">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-2/5" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-1/3" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-1/5" />
          <Skeleton className="h-4 w-10/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
