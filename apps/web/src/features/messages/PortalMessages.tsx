import type { CSSProperties } from "react";
import { useParams } from "wouter";
import MessagesWorkspace from "./MessagesWorkspace";

/** Messages in the worker portal: the same workspace, sized for the portal's top and tab bars. */
export default function PortalMessages() {
  const params = useParams<{ id?: string }>();
  return (
    <div style={{ "--msg-offset": "176px" } as CSSProperties}>
      <MessagesWorkspace base="/staff/messages" id={params.id} portal />
    </div>
  );
}
