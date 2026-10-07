import { SectionHeading } from "@/components/app/ui";
import NotesWorkspace from "./NotesWorkspace";

/** The back-office notebook (/app/notes). Everyone who can sign in to the back office has one. */
export default function NotesPage() {
  return (
    <>
      <div className="mobile-hide">
        <SectionHeading
          title="Notes"
          subtitle="Type, format, add pictures and keep them organised with labels. Only you can see your notes."
        />
      </div>
      <NotesWorkspace base="/app/notes" />
    </>
  );
}
