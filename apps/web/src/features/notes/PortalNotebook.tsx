import NotesWorkspace from "./NotesWorkspace";

/** The same notebook, inside the support-worker portal (/staff/notebook). Progress notes stay under "Notes". */
export default function PortalNotebook() {
  return <NotesWorkspace base="/staff/notebook" />;
}
